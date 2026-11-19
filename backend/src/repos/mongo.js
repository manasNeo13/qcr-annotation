/**
 * MongoDB repo over the main QCR app collections.
 *   environment — one doc per capture (env_id, store_id, …)
 *   metadata    — OCR reads, several per capture; row values = first non-null by newest timestamp
 *   users       — login (scrypt); access by assigned clients (users.clients), NHQ sees all
 *   store       — store ids (field `id`)
 * Edits write to the NEWEST metadata doc of a capture; previous values pushed to annotation_history.
 */
import dns from 'node:dns';
import { MongoClient, ObjectId } from 'mongodb';
import { env } from '../config/env.js';
import { SDK_EDITOR, computeEditStats, diffFields, editedPage } from '../lib/editStats.js';
import { HttpError } from '../lib/httpError.js';
import { clientsOf, isSuperAdmin, roleKey } from '../lib/permissions.js';
import { IST_OFFSET_MS, istWindow } from '../lib/istDay.js';
import { NEAR_EXPIRY_PCT, startOfToday, toISODate } from '../lib/status.js';
import { NONE_KEY } from '../lib/validation.js';
import { safeDecode } from '../lib/safeDecode.js';

const ACCESS_TTL_MS = 60_000;

let client;
let db;
const col = (n) => db.collection(n);
/** Raw db handle for sibling modules (repos/admin.js). */
export const getDb = () => db;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Access ────────────────────────────────────────────────────────────────
const accessCache = new Map(); // userId → { at, rows, envIds }
/** Drop cached store scope (user's stores/role/status changed). No id = everyone. */
export const clearAccessCache = (userId) => (userId ? accessCache.delete(userId) : accessCache.clear());

/** Client key of a capture: environment.client_name trimmed + lowercased; '' = no client. */
const clientKey = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Per-user scope by CLIENT (stores ignored). Cached 1 min.
 *   NHQ (super admin) → every capture, incl. captures with no client.
 *   Others → captures whose environment.client_name is in users.clients. None assigned → nothing.
 * clientKeys: null = all; else Set of client keys → live capture events (services/live.js).
 */
async function scope(userId, fresh = false) {
  const hit = accessCache.get(userId);
  if (!fresh && hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit;
  const user = await col('users').findOne({ id: userId }, { projection: { role: 1, status: 1, clients: 1 } });
  if (!user || user.status === false) throw new HttpError(401, 'Account not active');
  const superAdmin = isSuperAdmin(roleKey(user.role));
  const mine = clientsOf(user).map(clientKey);
  const raw =
    superAdmin || mine.length
      ? await col('environment')
          .find(superAdmin ? {} : { client_name: { $type: 'string' } }, { projection: { _id: 0, env_id: 1, client_name: 1 } })
          .toArray()
      : [];
  const allowed = new Set(mine);
  const rows = raw
    .filter((r) => r.env_id)
    .map((r) => ({ env: r.env_id, client: clientKey(r.client_name) }))
    .filter((r) => superAdmin || allowed.has(r.client));
  const s = { at: Date.now(), rows, envIds: rows.map((r) => r.env), clientKeys: superAdmin ? null : allowed, superAdmin };
  accessCache.set(userId, s);
  return s;
}

const allowedEnvIds = async (userId) => (await scope(userId)).envIds;

/** Allowed env ids narrowed by client filter. NONE_KEY = captures with no client (super admin only). */
async function scopedEnvIds(userId, { client } = {}) {
  const s = await scope(userId);
  if (!client) return s.envIds;
  const c = client === NONE_KEY ? '' : clientKey(client);
  return s.rows.filter((r) => r.client === c).map((r) => r.env);
}

async function assertCanAccess(userId, envId) {
  if (!(await allowedEnvIds(userId)).includes(envId)) {
    // Fresh capture may postdate cache → retry once uncached.
    if (!(await scope(userId, true)).envIds.includes(envId)) throw new HttpError(404, 'Document not found');
  }
}

// ── Aggregation ──────────────────────────────────────────────────────────
const firstNonNull = (arr) => ({ $arrayElemAt: [{ $filter: { input: arr, cond: { $ne: ['$$this', null] } } }, 0] });
const toDate = (x) => ({ $convert: { input: x, to: 'date', onError: null, onNull: null } });

/** metadata docs → one row per env_id, with status. */
const RAW_FIELDS = ['env_id', 'timestamp', 'img_url', 'mrp', 'mfg_date', 'expiry_date', 'batch_no', 'ean', 'edited_by', 'edited_at', 'annotation_version', 'annotation_history'];

/** Editor name for edits made outside this dashboard (root ≠ predicted, no edited_by). */
export const STORE_USER = SDK_EDITOR;

/** Original OCR values. Docs without `predicted` → own root values (= unedited). */
const predictedOf = {
  $cond: [
    { $eq: [{ $type: '$predicted' }, 'object'] },
    '$predicted',
    { mrp: '$mrp', mfg_date: '$mfg_date', expiry_date: '$expiry_date', batch_no: '$batch_no' },
  ],
};

/** metadata docs → one row per env_id, with status. envIds = allowed set (filtered AFTER group — $in before group is ~15x slower on Cosmos). */
function rowStages(envIds, { from, to } = {}) {
  const today = startOfToday();
  return [
    { $project: { ...Object.fromEntries(RAW_FIELDS.map((f) => [f, 1])), pred: predictedOf } },
    { $sort: { env_id: 1, timestamp: -1 } },
    {
      $group: {
        _id: '$env_id',
        ts: { $first: '$timestamp' },
        img: { $first: '$img_url' },
        editedBy: { $first: '$edited_by' },
        editedAt: { $first: '$edited_at' },
        version: { $first: '$annotation_version' },
        history: { $first: '$annotation_history' },
        mrps: { $push: '$mrp' },
        mfgs: { $push: '$mfg_date' },
        exps: { $push: '$expiry_date' },
        batches: { $push: '$batch_no' },
        eans: { $push: '$ean' },
        pMrps: { $push: '$pred.mrp' },
        pMfgs: { $push: '$pred.mfg_date' },
        pExps: { $push: '$pred.expiry_date' },
        pBatches: { $push: '$pred.batch_no' },
      },
    },
    ...(envIds ? [{ $match: { _id: { $in: envIds } } }] : []),
    // Date filter on capture time (latest read), IST days.
    ...(from ? [{ $match: { ts: { $gte: istWindow(from, to).start, $lte: istWindow(from, to).end } } }] : []),
    {
      $project: {
        ts: 1, img: 1, editedBy: 1, editedAt: 1, version: 1, history: 1,
        mrp: firstNonNull('$mrps'),
        mfg: toDate(firstNonNull('$mfgs')),
        exp: toDate(firstNonNull('$exps')),
        batch: firstNonNull('$batches'),
        ean: firstNonNull('$eans'),
        pred: {
          mrp: firstNonNull('$pMrps'),
          mfg: toDate(firstNonNull('$pMfgs')),
          exp: toDate(firstNonNull('$pExps')),
          batch: firstNonNull('$pBatches'),
        },
      },
    },
    {
      $addFields: {
        status: {
          $switch: {
            branches: [
              { case: { $and: [{ $ne: ['$exp', null] }, { $lt: ['$exp', today] }] }, then: 'expired' },
              {
                case: {
                  $and: [
                    { $ne: ['$exp', null] },
                    { $ne: ['$mfg', null] },
                    { $gt: ['$exp', '$mfg'] },
                    { $lt: [{ $divide: [{ $subtract: ['$exp', today] }, { $subtract: ['$exp', '$mfg'] }] }, NEAR_EXPIRY_PCT / 100] },
                  ],
                },
                then: 'near_expiry',
              },
            ],
            default: 'ok',
          },
        },
      },
    },
  ];
}

function searchStage(q) {
  if (!q) return [];
  const re = new RegExp(escapeRe(q), 'i');
  return [{ $match: { $or: [{ batch: re }, { ean: re }, { _id: re }] } }];
}

/** EAN / batch drill-down. NONE_KEY = missing ('' or null). */
function drillStage({ ean, batch }) {
  const m = (field, v) => (v === NONE_KEY ? { $or: [{ [field]: null }, { [field]: '' }] } : { [field]: v });
  const and = [];
  if (ean) and.push(m('ean', ean));
  if (batch) and.push(m('batch', batch));
  return and.length ? [{ $match: { $and: and } }] : [];
}

const statusCount = (st) => ({ $sum: { $cond: [{ $eq: ['$status', st] }, 1, 0] } });
const keyOf = (field) => ({ $cond: [{ $eq: [{ $ifNull: [field, ''] }, ''] }, NONE_KEY, { $toString: field }] });

/** Shared pipeline head: scoped rows + date + search + drill-down. null = nothing in scope. */
async function filteredRows(f, user) {
  const envIds = await scopedEnvIds(user.id, f);
  if (!envIds.length) return null;
  return [...rowStages(envIds, f), ...searchStage(f.q), ...drillStage(f)];
}

const emptyCounts = () => ({ all: 0, ok: 0, near_expiry: 0, expired: 0 });

const iso = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d : null);
const fileOf = (url) => (url ? safeDecode(String(url).split('?')[0].split('/').pop() || '') : '');

/** Raw row values { mrp, mfg, exp, batch } → DTO metadata. */
const metaOf = (v = {}) => ({
  mfgDate: iso(v.mfg) ? toISODate(v.mfg) : '',
  expiryDate: iso(v.exp) ? toISODate(v.exp) : '',
  batchNumber: v.batch != null ? String(v.batch) : '',
  mrp: v.mrp != null && !Number.isNaN(Number(v.mrp)) ? Number(v.mrp) : null,
});

/**
 * Outside edits (other apps write root fields, leave `predicted`, no edited_by/edited_at).
 * First known state (history[0] or current) ≠ predicted → prepend predicted as v0,
 * attribute that change to STORE_USER. Edits after a dashboard save stay undetectable.
 */
function withOutsideEdit(dto, r) {
  if (!r.pred) return dto;
  const predicted = metaOf(r.pred);
  const h = dto.history;
  const first = h[0]?.metadata ?? dto.metadata;
  if (!diffFields(predicted, first).length) return dto;
  const v0 = { version: 0, metadata: predicted, editedBy: 'system', editedAt: dto.createdAt };
  if (h.length) {
    const h0 = h[0].editedBy && h[0].editedBy !== 'system' ? h[0] : { ...h[0], editedBy: STORE_USER };
    return { ...dto, history: [v0, h0, ...h.slice(1)] };
  }
  return { ...dto, history: [v0], updatedBy: dto.updatedBy ?? STORE_USER };
}

function toDto(r) {
  const ts = iso(r.ts)?.toISOString() ?? new Date(0).toISOString();
  const ean = r.ean != null ? String(r.ean) : '';
  return withOutsideEdit({
    id: r._id,
    productName: ean ? `EAN ${ean}` : 'No EAN',
    ean,
    fileName: fileOf(r.img),
    imageRef: r.img || '',
    metadata: metaOf(r),
    status: r.status,
    version: Number(r.version) || 1,
    createdAt: ts,
    updatedAt: iso(r.editedAt)?.toISOString() ?? ts,
    updatedBy: r.editedBy ?? undefined,
    history: Array.isArray(r.history) ? r.history : [],
  }, r);
}

async function getRow(envId) {
  const [row] = await col('metadata').aggregate([{ $match: { env_id: envId } }, ...rowStages()]).toArray();
  return row ? toDto(row) : null;
}

/** Edited captures only (dashboard history or outside edit) in scope + capture range + search → DTOs. */
async function editedRows({ from, to, client, q }, user) {
  const envIds = await scopedEnvIds(user.id, { client });
  if (!envIds.length) return [];
  const rows = await col('metadata')
    .aggregate([...rowStages(envIds, { from, to }), ...searchStage(q)], { allowDiskUse: true })
    .toArray();
  return rows.map(toDto).filter((d) => d.history.length);
}

/** metadata doc → live event fields. */
const liveDoc = (d) => ({
  id: String(d._id),
  env: d.env_id ?? null,
  ts: (iso(d.timestamp) ?? (d._id instanceof ObjectId ? d._id.getTimestamp() : new Date())).toISOString(),
  ean: d.ean != null ? String(d.ean) : '',
  batch: d.batch_no != null ? String(d.batch_no) : '',
  hasImage: !!d.img_url,
});

// ── Repo ─────────────────────────────────────────────────────────────────
export const mongoRepo = {
  name: 'mongo',
  async init() {
    // Some networks' DNS (home routers, mobile hotspots) refuse SRV lookups → querySrv ECONNREFUSED.
    // Override with DNS_SERVERS=8.8.8.8,1.1.1.1 in .env (unset = system DNS).
    if (process.env.DNS_SERVERS) dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()));
    client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();
    db = client.db();
    await db.command({ ping: 1 });
    console.log(`[repo] mongo — db "${db.databaseName}"`);
  },
  async close() {
    await client?.close();
  },

  /**
   * Live captures (services/live.js). Reads metadata by _id only (default index) → cheap on any Mongo.
   * ObjectId _id carries insert time → "everything inserted after T" = _id > ObjectId(T).
   */
  live: {
    /** Recent metadata docs: _id inserted at/after `sinceMs` (overlap handled by caller). */
    async since(sinceMs, limit = 1000) {
      const docs = await col('metadata')
        .find(
          { _id: { $gte: ObjectId.createFromTime(Math.floor(sinceMs / 1000)) } },
          { projection: { env_id: 1, timestamp: 1, img_url: 1, ean: 1, batch_no: 1 } },
        )
        .sort({ _id: 1 })
        .limit(limit)
        .toArray();
      return docs.filter((d) => d._id instanceof ObjectId).map(liveDoc);
    },

    /** Re-check docs that had no image / no environment yet. */
    async byIds(ids) {
      if (!ids.length) return [];
      const docs = await col('metadata')
        .find({ _id: { $in: ids.map((i) => new ObjectId(i)) } }, { projection: { env_id: 1, timestamp: 1, img_url: 1, ean: 1, batch_no: 1 } })
        .toArray();
      return docs.map(liveDoc);
    },

    /** env_id → access keys ["client:<key>"] ('' = no client). Missing env = not in map. */
    async storesOf(envIds) {
      const map = new Map();
      if (!envIds.length) return map;
      const rows = await col('environment')
        .find({ env_id: { $in: envIds } }, { projection: { _id: 0, env_id: 1, client_name: 1 } })
        .toArray();
      for (const r of rows) map.set(r.env_id, [`client:${clientKey(r.client_name)}`]);
      return map;
    },

    /**
     * Value fingerprints of metadata docs inserted since `sinceMs`, newest first (by _id → default index).
     * Compared tick to tick → edits by any app (SDK, main app, this dashboard) and deletions.
     */
    async prints(sinceMs, limit) {
      const docs = await col('metadata')
        .find(
          { _id: { $gte: ObjectId.createFromTime(Math.floor(sinceMs / 1000)) } },
          { projection: { env_id: 1, mrp: 1, mfg_date: 1, expiry_date: 1, batch_no: 1, ean: 1, annotation_version: 1, img_url: 1 } },
        )
        .sort({ _id: -1 })
        .limit(limit)
        .toArray();
      return docs.map((d) => ({
        id: String(d._id),
        env: d.env_id ?? null,
        hash: JSON.stringify([d.mrp, d.mfg_date, d.expiry_date, d.batch_no, d.ean, d.annotation_version, d.img_url]),
      }));
    },

    /** Total metadata docs (collection metadata, no scan) — a drop means captures were deleted. */
    async count() {
      return col('metadata').estimatedDocumentCount();
    },

    /** New captures announced → store scope caches (env id lists) are stale; lists must include the new ids. */
    onAnnounced() {
      clearAccessCache();
    },

    /** Events this user may see (same client scope as lists). Throws 401 if account inactive. */
    async visibleTo(user, events) {
      const { clientKeys } = await scope(user.id);
      if (!clientKeys) return events; // super admin
      return events.filter((e) => e.stores.some((k) => k.startsWith('client:') && clientKeys.has(k.slice(7))));
    },
  },

  users: {
    /** Login lookup. Returns null | user; throws 409 on duplicate email. */
    async findForLogin(email) {
      const found = await col('users')
        .find({ email: new RegExp(`^${escapeRe(email)}$`, 'i'), password: { $exists: true } })
        .project({ id: 1, name: 1, email: 1, password: 1, status: 1, role: 1, must_change_password: 1 })
        .limit(2)
        .toArray();
      if (found.length > 1) throw new HttpError(409, 'Multiple accounts use this email — contact admin');
      const u = found[0];
      if (!u) return null;
      return {
        id: String(u.id ?? u._id),
        name: String(u.name ?? u.email),
        email: String(u.email),
        role: u.role != null ? String(u.role) : '',
        active: u.status !== false,
        passwordHash: String(u.password ?? ''),
        mustChangePassword: u.must_change_password === true,
      };
    },

    /** Stored hash for password change (null = no user / no password). */
    async passwordHashOf(userId) {
      const u = await col('users').findOne({ id: userId }, { projection: { password: 1, status: 1 } });
      if (!u || u.status === false) throw new HttpError(401, 'Account not active');
      return u.password ? String(u.password) : null;
    },

    /** User sets own password → clears the "change on first login" flag. */
    async setOwnPassword(userId, hash) {
      await col('users').updateOne(
        { id: userId },
        { $set: { password: hash, must_change_password: false, password_changed_at: new Date(), updatedAt: new Date() } },
      );
    },
  },

  documents: {
    async list(f, user) {
      const { page, pageSize, status } = f;
      const empty = emptyCounts();
      const head = await filteredRows(f, user);
      if (!head) return { items: [], total: 0, counts: empty };
      const [res] = await col('metadata')
        .aggregate(
          [
            ...head,
            {
              $facet: {
                counts: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
                items: [
                  ...(status === 'all' ? [] : [{ $match: { status } }]),
                  { $sort: { ts: -1, _id: -1 } },
                  { $skip: (page - 1) * pageSize },
                  { $limit: pageSize },
                ],
              },
            },
          ],
          { allowDiskUse: true },
        )
        .toArray();
      const counts = { ...empty };
      for (const c of res.counts) counts[c._id] = c.n;
      counts.all = counts.ok + counts.near_expiry + counts.expired;
      return { items: res.items.map(toDto), total: counts[status], counts };
    },

    /** Captures per IST day in [from, to] + latest day with data — calendar dots. */
    async dayCounts({ from, to, ...f }, user) {
      const envIds = await scopedEnvIds(user.id, f);
      if (!envIds.length) return { days: [], latest: null };
      const [res] = await col('metadata')
        .aggregate(
          [
            ...rowStages(envIds),
            { $project: { ts: 1 } },
            {
              $facet: {
                latest: [{ $sort: { ts: -1 } }, { $limit: 1 }],
                days: [
                  { $match: { ts: { $gte: istWindow(from, to).start, $lte: istWindow(from, to).end } } },
                  {
                    $group: {
                      _id: { $dateToString: { format: '%Y-%m-%d', date: { $add: ['$ts', IST_OFFSET_MS] } } },
                      count: { $sum: 1 },
                    },
                  },
                  { $sort: { _id: 1 } },
                ],
              },
            },
          ],
          { allowDiskUse: true },
        )
        .toArray();
      const latestTs = res.latest[0]?.ts;
      return {
        days: res.days.map((d) => ({ date: d._id, count: d.count })),
        latest: latestTs ? new Date(latestTs.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10) : null,
      };
    },

    /** Dropdown options within user scope. noClient = captures without client exist (super admin only). */
    async filterOptions(user) {
      const s = await scope(user.id);
      return {
        clients: [...new Set(s.rows.map((r) => r.client).filter(Boolean))].sort((x, y) => x.localeCompare(y)),
        noClient: s.rows.some((r) => !r.client),
      };
    },

    /** Grouped list. by = 'ean' (with batch count) | 'batch' (usually inside f.ean). */
    async groups(by, f, user) {
      const { page, pageSize, status } = f;
      const counts = emptyCounts();
      const head = await filteredRows(f, user);
      if (!head) return { items: [], total: 0, counts };
      const field = by === 'ean' ? '$ean' : '$batch';
      const [res] = await col('metadata')
        .aggregate(
          [
            ...head,
            {
              $facet: {
                counts: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
                groups: [
                  ...(status === 'all' ? [] : [{ $match: { status } }]),
                  {
                    $group: {
                      _id: keyOf(field),
                      total: { $sum: 1 },
                      ok: statusCount('ok'),
                      near_expiry: statusCount('near_expiry'),
                      expired: statusCount('expired'),
                      latest: { $max: '$ts' },
                      ...(by === 'ean' ? { batchSet: { $addToSet: keyOf('$batch') } } : {}),
                    },
                  },
                  ...(by === 'ean' ? [{ $addFields: { batches: { $size: '$batchSet' } } }, { $project: { batchSet: 0 } }] : []),
                  // EANs: most batches first (then most captures, newest). Batches: newest first.
                  { $sort: by === 'ean' ? { batches: -1, total: -1, latest: -1, _id: 1 } : { latest: -1, _id: 1 } },
                ],
              },
            },
          ],
          { allowDiskUse: true },
        )
        .toArray();
      for (const c of res.counts) counts[c._id] = c.n;
      counts.all = counts.ok + counts.near_expiry + counts.expired;
      const start = (page - 1) * pageSize;
      return {
        total: res.groups.length,
        counts,
        items: res.groups.slice(start, start + pageSize).map((x) => ({
          key: x._id,
          total: x.total,
          ...(by === 'ean' ? { batches: x.batches } : {}),
          counts: { ok: x.ok, near_expiry: x.near_expiry, expired: x.expired },
          latest: iso(x.latest)?.toISOString() ?? null,
        })),
      };
    },

    /** Edit stats over scoped captures in [from, to] (capture day). */
    async editStats({ from, to, client, detail }, user) {
      const envIds = await scopedEnvIds(user.id, { client });
      if (!envIds.length) return computeEditStats([], { detail });
      const rows = await col('metadata')
        .aggregate(rowStages(envIds, { from, to }), { allowDiskUse: true })
        .toArray();
      return computeEditStats(rows.map(toDto), { detail });
    },

    /** Stats drill-down list: scoped captures in range + search, filtered by edit rules in JS. */
    async edited(f, user) {
      return editedPage(await editedRows(f, user), f);
    },

    async editedIds(f, user) {
      return editedPage(await editedRows(f, user), { ...f, pageSize: Infinity }).items.map((d) => d.id);
    },

    async get(id, user) {
      await assertCanAccess(user.id, id);
      return getRow(id);
    },

    /** Ordered ids (same filter + sort as list) — for prev/next navigation. */
    async orderedIds(f, user) {
      const { status } = f;
      const head = await filteredRows(f, user);
      if (!head) return [];
      const rows = await col('metadata')
        .aggregate(
          [
            ...head,
            ...(status === 'all' ? [] : [{ $match: { status } }]),
            { $sort: { ts: -1, _id: -1 } },
            { $project: { _id: 1 } },
          ],
          { allowDiskUse: true },
        )
        .toArray();
      return rows.map((r) => r._id);
    },

    async update(id, metadata, user) {
      await assertCanAccess(user.id, id);
      const cur = await getRow(id);
      if (!cur) return null;
      const [latest] = await col('metadata').find({ env_id: id }).sort({ timestamp: -1 }).limit(1).toArray();
      const now = new Date();
      const updated = await col('metadata').findOneAndUpdate(
        { _id: latest._id, annotation_version: latest.annotation_version ?? null }, // optimistic lock
        {
          $set: {
            mfg_date: new Date(`${metadata.mfgDate}T00:00:00Z`),
            expiry_date: new Date(`${metadata.expiryDate}T00:00:00Z`),
            batch_no: metadata.batchNumber,
            mrp: metadata.mrp,
            edited_by: user.name || user.email,
            edited_at: now,
            annotation_version: cur.version + 1,
          },
          $push: {
            annotation_history: {
              version: cur.version,
              metadata: cur.metadata,
              editedBy: cur.updatedBy ?? 'system',
              editedAt: cur.updatedAt,
            },
          },
        },
        { returnDocument: 'after' },
      );
      if (!updated) throw new HttpError(409, 'Capture changed meanwhile — reload and retry');
      return getRow(id);
    },
  },
};

