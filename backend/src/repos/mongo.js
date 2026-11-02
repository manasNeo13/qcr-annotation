/**
 * MongoDB repo over the main QCR app collections.
 *   environment — one doc per capture (env_id, store_id, …)
 *   metadata    — OCR reads, several per capture; row values = first non-null by newest timestamp
 *   users       — login (scrypt), store access via role + format_id
 *   store       — store ids (field `id`)
 * Edits write to the NEWEST metadata doc of a capture; previous values pushed to annotation_history.
 */
import { MongoClient } from 'mongodb';
import { env } from '../config/env.js';
import { HttpError } from '../lib/httpError.js';
import { IST_OFFSET_MS, istWindow } from '../lib/istDay.js';
import { NEAR_EXPIRY_PCT, startOfToday, toISODate } from '../lib/status.js';

const ORG_WIDE_ROLES = ['nhq', 'organization admin', 'admin', 'org admin'];
const ACCESS_TTL_MS = 60_000;

let client;
let db;
const col = (n) => db.collection(n);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Access ────────────────────────────────────────────────────────────────
const accessCache = new Map(); // userId → { at, envIds }

/** Store ids the user may see (mirrors main app services/userAccess.js). */
async function allowedStoreIds(userId) {
  const user = await col('users').findOne({ id: userId }, { projection: { role: 1, format_id: 1, org_id: 1, status: 1 } });
  if (!user || user.status === false) throw new HttpError(401, 'Account not active');
  // NOTE: stores currently have no org_id → no org filter when user/org missing.
  const orgFilter = user.org_id ? { org_id: { $in: [user.org_id, String(user.org_id)] } } : {};
  const orgStores = await col('store').distinct('id', orgFilter);
  if (ORG_WIDE_ROLES.includes(String(user.role ?? '').trim().toLowerCase())) return orgStores;
  const own = Array.isArray(user.format_id) ? user.format_id : user.format_id ? [user.format_id] : [];
  return orgStores.filter((s) => own.includes(s));
}

async function allowedEnvIds(userId) {
  const hit = accessCache.get(userId);
  if (hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit.envIds;
  const stores = await allowedStoreIds(userId);
  const envIds = stores.length ? await col('environment').distinct('env_id', { store_id: { $in: stores } }) : [];
  accessCache.set(userId, { at: Date.now(), envIds });
  return envIds;
}

async function assertCanAccess(userId, envId) {
  const ids = await allowedEnvIds(userId);
  if (!ids.includes(envId)) {
    // Fresh capture may postdate cache → retry once uncached.
    accessCache.delete(userId);
    if (!(await allowedEnvIds(userId)).includes(envId)) throw new HttpError(404, 'Document not found');
  }
}

// ── Aggregation ──────────────────────────────────────────────────────────
const firstNonNull = (arr) => ({ $arrayElemAt: [{ $filter: { input: arr, cond: { $ne: ['$$this', null] } } }, 0] });
const toDate = (x) => ({ $convert: { input: x, to: 'date', onError: null, onNull: null } });

/** metadata docs → one row per env_id, with status. */
const RAW_FIELDS = ['env_id', 'timestamp', 'img_url', 'mrp', 'mfg_date', 'expiry_date', 'batch_no', 'ean', 'edited_by', 'edited_at', 'annotation_version', 'annotation_history'];

/** metadata docs → one row per env_id, with status. envIds = allowed set (filtered AFTER group — $in before group is ~15x slower on Cosmos). */
function rowStages(envIds, { from, to } = {}) {
  const today = startOfToday();
  return [
    { $project: Object.fromEntries(RAW_FIELDS.map((f) => [f, 1])) },
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

const iso = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d : null);
const fileOf = (url) => (url ? decodeURIComponent(String(url).split('?')[0].split('/').pop() || '') : '');

function toDto(r) {
  const ts = iso(r.ts)?.toISOString() ?? new Date(0).toISOString();
  const ean = r.ean != null ? String(r.ean) : '';
  return {
    id: r._id,
    productName: ean ? `EAN ${ean}` : 'No EAN',
    fileName: fileOf(r.img),
    imageRef: r.img || '',
    metadata: {
      mfgDate: iso(r.mfg) ? toISODate(r.mfg) : '',
      expiryDate: iso(r.exp) ? toISODate(r.exp) : '',
      batchNumber: r.batch != null ? String(r.batch) : '',
      mrp: r.mrp != null && !Number.isNaN(Number(r.mrp)) ? Number(r.mrp) : null,
    },
    status: r.status,
    version: Number(r.version) || 1,
    createdAt: ts,
    updatedAt: iso(r.editedAt)?.toISOString() ?? ts,
    updatedBy: r.editedBy ?? undefined,
    history: Array.isArray(r.history) ? r.history : [],
  };
}

async function getRow(envId) {
  const [row] = await col('metadata').aggregate([{ $match: { env_id: envId } }, ...rowStages()]).toArray();
  return row ? toDto(row) : null;
}

// ── Repo ─────────────────────────────────────────────────────────────────
export const mongoRepo = {
  name: 'mongo',
  async init() {
    client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();
    db = client.db();
    await db.command({ ping: 1 });
    console.log(`[repo] mongo — db "${db.databaseName}"`);
  },
  async close() {
    await client?.close();
  },

  users: {
    /** Login lookup. Returns null | user; throws 409 on duplicate email. */
    async findForLogin(email) {
      const found = await col('users')
        .find({ email: new RegExp(`^${escapeRe(email)}$`, 'i'), password: { $exists: true } })
        .project({ id: 1, name: 1, email: 1, password: 1, status: 1, role: 1 })
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
      };
    },
  },

  documents: {
    async list({ page, pageSize, q, status, from, to }, user) {
      const envIds = await allowedEnvIds(user.id);
      const empty = { all: 0, ok: 0, near_expiry: 0, expired: 0 };
      if (!envIds.length) return { items: [], total: 0, counts: empty };
      const [res] = await col('metadata')
        .aggregate(
          [
            ...rowStages(envIds, { from, to }),
            ...searchStage(q),
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
    async dayCounts({ from, to }, user) {
      const envIds = await allowedEnvIds(user.id);
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

    async get(id, user) {
      await assertCanAccess(user.id, id);
      return getRow(id);
    },

    /** Ordered ids (same filter + sort as list) — for prev/next navigation. */
    async orderedIds({ q, status, from, to }, user) {
      const envIds = await allowedEnvIds(user.id);
      if (!envIds.length) return [];
      const rows = await col('metadata')
        .aggregate(
          [
            ...rowStages(envIds, { from, to }),
            ...searchStage(q),
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

