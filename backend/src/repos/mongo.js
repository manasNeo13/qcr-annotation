/**
 * MongoDB repo over the main QCR app collections.
 *   environment — one doc per capture (env_id, store_id, …)
 *   metadata    — OCR reads, several per capture; row values = first non-null by newest timestamp
 *                 NEW scans (engine v3, have `started_at`): one doc per scan session, own `client`, `best_images`;
 *                 recaptures reuse env_id → row = newest scan only. Values come from session_results.
 *   session_results — per scan (metadata_id → metadata._id): predicted + edited_values (SDK + dashboard edits)
 *   users       — login (scrypt); access by assigned clients (users.clients), NHQ sees all
 *   store       — store ids (field `id`)
 * Edits write to the NEWEST metadata doc of a capture; previous values pushed to annotation_history.
 */
import dns from 'node:dns';
import { MongoClient, ObjectId } from 'mongodb';
import { env } from '../config/env.js';
import { SDK_EDITOR, computeEditStats, diffFields, editedPage } from '../lib/editStats.js';
import { computeAccuracy } from '../lib/accuracy.js';
import { HttpError } from '../lib/httpError.js';
import { clientsOf, isSuperAdmin, roleKey } from '../lib/permissions.js';
import { IST_OFFSET_MS, istDay, istWindow } from '../lib/istDay.js';
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
export const clearAccessCache = (userId) => {
  if (userId) return accessCache.delete(userId);
  accessCache.clear();
  scanCache = null;
  ownerCache = null;
};

/** Split team: env_id → assigned user id (only assigned captures). Shared, cached 1 min. */
let ownerCache = null; // { at, map: Promise<Map> }
function owners() {
  if (ownerCache && Date.now() - ownerCache.at < ACCESS_TTL_MS) return ownerCache.map;
  const map = col('metadata')
    .find({ assigned_to: { $exists: true } }, { projection: { _id: 0, env_id: 1, assigned_to: 1 } })
    .toArray()
    .then((docs) => new Map(docs.map((d) => [d.env_id, String(d.assigned_to)])));
  ownerCache = { at: Date.now(), map };
  map.catch(() => (ownerCache = null));
  return map;
}

/** New-schema scans (have started_at): env_id → client (metadata.client). Shared by all users, cached 1 min. */
let scanCache = null; // { at, rows: Promise<{ env, client }[]> }
function scanEnvs() {
  if (scanCache && Date.now() - scanCache.at < ACCESS_TTL_MS) return scanCache.rows;
  const rows = col('metadata')
    .find({ started_at: { $exists: true } }, { projection: { _id: 0, env_id: 1, client: 1 } })
    .sort({ _id: 1 })
    .toArray()
    .then((docs) => {
      const m = new Map(); // newest scan wins (sorted by insert)
      for (const d of docs) if (d.env_id) m.set(d.env_id, clientKey(d.client));
      return [...m].map(([env, client]) => ({ env, client }));
    });
  scanCache = { at: Date.now(), rows };
  rows.catch(() => (scanCache = null));
  return rows;
}

/** Client key of a capture: environment.client_name trimmed + lowercased; '' = no client. */
const clientKey = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Per-user scope by CLIENT (stores ignored). Cached 1 min.
 *   NHQ (super admin) → every capture, incl. captures with no client.
 *   Split team member → every client: old (unassigned) captures + captures assigned to them (repos/split.js).
 *   Others → captures whose environment.client_name is in users.clients. None assigned → nothing.
 * clientKeys: null = all; else Set of client keys → live capture events (services/live.js).
 */
async function scope(userId, fresh = false) {
  const hit = accessCache.get(userId);
  if (!fresh && hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit;
  const user = await col('users').findOne({ id: userId }, { projection: { role: 1, status: 1, clients: 1, split_team: 1 } });
  if (!user || user.status === false) throw new HttpError(401, 'Account not active');
  const superAdmin = isSuperAdmin(roleKey(user.role));
  const member = !superAdmin && user.split_team === true;
  if (member) {
    const [raw, scans, own] = await Promise.all([
      col('environment').find({}, { projection: { _id: 0, env_id: 1, client_name: 1 } }).toArray(),
      scanEnvs(),
      owners(),
    ]);
    const rows = [...raw.filter((r) => r.env_id).map((r) => ({ env: r.env_id, client: clientKey(r.client_name) })), ...scans].filter((r) => {
      const o = own.get(r.env);
      return !o || o === userId;
    });
    const s = { at: Date.now(), rows, envIds: rows.map((r) => r.env), envSet: new Set(rows.map((r) => r.env)), clientKeys: null, superAdmin, member };
    accessCache.set(userId, s);
    return s;
  }
  const mine = clientsOf(user).map(clientKey);
  const [raw, scans] =
    superAdmin || mine.length
      ? await Promise.all([
          col('environment')
            .find(superAdmin ? {} : { client_name: { $type: 'string' } }, { projection: { _id: 0, env_id: 1, client_name: 1 } })
            .toArray(),
          scanEnvs(),
        ])
      : [[], []];
  const allowed = new Set(mine);
  // Old captures: client from environment. New scans: client from their own metadata doc.
  const rows = [...raw.filter((r) => r.env_id).map((r) => ({ env: r.env_id, client: clientKey(r.client_name) })), ...scans].filter(
    (r) => superAdmin || allowed.has(r.client),
  );
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

// ── Scan timings (CSV detail) ────────────────────────────────────────────
const isoOrNull = (v) => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
};

/**
 * New scans → request_id, started_at, finished_at, latency_ms of the latest recapture (same pick as the list).
 * Plain find + JS pick (no extra aggregation stages → no Cosmos quirks). Old captures stay without.
 */
async function addScanTimings(rows) {
  const ids = rows.map((r) => r.id);
  const latest = new Map();
  for (let i = 0; i < ids.length; i += 1000) {
    const docs = await col('metadata')
      .find(
        { env_id: { $in: ids.slice(i, i + 1000) }, started_at: { $exists: true } },
        { projection: { _id: 0, env_id: 1, request_id: 1, started_at: 1, finished_at: 1, latency_ms: 1 } },
      )
      .toArray();
    for (const d of docs) {
      const cur = latest.get(d.env_id);
      if (!cur || new Date(d.started_at) > new Date(cur.started_at)) latest.set(d.env_id, d);
    }
  }
  for (const r of rows) {
    const d = latest.get(r.id);
    r.requestId = d?.request_id != null ? String(d.request_id) : null;
    r.startedAt = d ? isoOrNull(d.started_at) : null;
    r.finishedAt = d ? isoOrNull(d.finished_at) : null;
    r.latencyMs = d && d.latency_ms && typeof d.latency_ms === 'object' ? d.latency_ms : null;
  }
}

// ── Aggregation ──────────────────────────────────────────────────────────
const firstNonNull = (arr) => ({ $arrayElemAt: [{ $filter: { input: arr, cond: { $ne: ['$$this', null] } } }, 0] });
const toDate = (x) => ({ $convert: { input: x, to: 'date', onError: null, onNull: null } });

/** metadata docs → one row per env_id, with status. */
const RAW_FIELDS = ['env_id', 'timestamp', 'started_at', 'is_recapture', 'img_url', 'best_images', 'mrp', 'mfg_date', 'expiry_date', 'batch_no', 'ean', 'edited_by', 'edited_at', 'annotation_version', 'annotation_history'];

// ── New scans: text values from session_results ("01-07-2026", "01/11/2024", "N/A") ──
/** "", "N/A", "NA", "null", "none" → null. */
const textOrNull = (x) => ({
  $cond: [{ $in: [{ $toUpper: { $trim: { input: { $ifNull: [{ $toString: x }, ''] } } } }, ['', 'N/A', 'NA', 'NULL', 'NONE']] }, null, x],
});
/**
 * "DD-MM-YYYY" / "DD/MM/YYYY" / "DD.MM.YYYY" → Date (UTC midnight); anything else → null.
 * Rebuilt as ISO "YYYY-MM-DD" + $convert: Cosmos $dateFromString gives random/mixed results when used
 * several times in one stage (values swapped between fields run to run).
 */
const dmyDate = (x) => ({
  $let: {
    vars: {
      s: {
        $ifNull: [
          { $replaceAll: { input: { $replaceAll: { input: { $toString: x }, find: '/', replacement: '-' } }, find: '.', replacement: '-' } },
          '',
        ],
      },
    },
    in: {
      $cond: [
        { $regexMatch: { input: '$$s', regex: '^\\d{2}-\\d{2}-\\d{4}$' } },
        {
          $convert: {
            input: { $concat: [{ $substrCP: ['$$s', 6, 4] }, '-', { $substrCP: ['$$s', 3, 2] }, '-', { $substrCP: ['$$s', 0, 2] }] },
            to: 'date',
            onError: null,
            onNull: null,
          },
        },
        null,
      ],
    },
  },
});
const IS_SCAN = { $ne: [{ $ifNull: ['$scanId', null] }, null] };

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

/**
 * Capture time only (same `ts` as rowStages) → one row { _id: env_id, ts }.
 * Calendar dots / latest day: no session_results lookup, no values → much cheaper.
 */
function tsStages(envIds) {
  return [
    { $project: { env_id: 1, timestamp: 1, started_at: 1, is_recapture: 1 } },
    {
      $group: {
        _id: '$env_id',
        ts: { $max: '$timestamp' },
        latestScan: {
          $max: {
            $cond: [
              { $ifNull: ['$started_at', false] },
              { recapture: { $cond: [{ $ifNull: ['$is_recapture', false] }, 1, 0] }, t: '$started_at' },
              null,
            ],
          },
        },
      },
    },
    { $match: { _id: { $in: envIds } } },
    { $project: { ts: { $ifNull: ['$ts', '$latestScan.t'] } } },
  ];
}

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
        // New scans: prefer is_recapture=true first, then latest started_at.
        // $max on the object compares fields in order: recapture (1 > 0) wins, then t (ISO date).
        latestScan: {
          $max: {
            $cond: [
              { $ifNull: ['$started_at', false] },
              {
                recapture: { $cond: [{ $ifNull: ['$is_recapture', false] }, 1, 0] },
                t: '$started_at',
                id: '$_id',
                imgs: '$best_images',
              },
              null,
            ],
          },
        },
        editedBy: { $first: '$edited_by' },
        editedAt: { $first: '$edited_at' },
        assignee: { $max: '$assigned_to' },
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
    {
      $addFields: {
        ts: { $ifNull: ['$ts', '$latestScan.t'] },
        scanId: { $ifNull: ['$latestScan.id', null] },
        images: '$latestScan.imgs',
      },
    },
    ...(envIds ? [{ $match: { _id: { $in: envIds } } }] : []),
    // Date filter on capture time (latest read), IST days.
    ...(from ? [{ $match: { ts: { $gte: istWindow(from, to).start, $lte: istWindow(from, to).end } } }] : []),
    // New scans → their session_results doc (indexed metadata_id). Old rows have scanId null → no match.
    { $lookup: { from: 'session_results', localField: 'scanId', foreignField: 'metadata_id', as: 'sr' } },
    { $addFields: { sr: { $arrayElemAt: ['$sr', 0] } } },
    // Current = predicted with edited_values on top (latest edit wins).
    { $addFields: { cur: { $mergeObjects: [{ $ifNull: ['$sr.predicted', {}] }, { $ifNull: ['$sr.edited_values', {}] }] } } },
    {
      $project: {
        ts: 1, img: 1, version: 1, history: 1, images: 1, assignee: 1, scanId: 1,
        scan: IS_SCAN,
        noResult: { $and: [IS_SCAN, { $eq: [{ $type: '$sr' }, 'missing'] }] },
        // Scans: edited_by = dashboard user id (SDK edits leave it unset); time = updated_at once edited.
        editedBy: { $cond: [IS_SCAN, '$sr.edited_by', '$editedBy'] },
        editedAt: { $cond: [IS_SCAN, { $cond: [{ $eq: ['$sr.edited', true] }, '$sr.updated_at', null] }, '$editedAt'] },
        mrp: { $cond: [IS_SCAN, textOrNull('$cur.mrp'), firstNonNull('$mrps')] },
        mfg: { $cond: [IS_SCAN, dmyDate(textOrNull('$cur.mfd')), toDate(firstNonNull('$mfgs'))] },
        exp: { $cond: [IS_SCAN, dmyDate(textOrNull('$cur.exp')), toDate(firstNonNull('$exps'))] },
        batch: { $cond: [IS_SCAN, textOrNull('$cur.batch'), firstNonNull('$batches')] },
        ean: firstNonNull('$eans'),
        // Original values, flat (Cosmos returns null for $dateFromString inside a nested object) → r.pred in toDto.
        pMrp: { $cond: [IS_SCAN, textOrNull('$sr.predicted.mrp'), firstNonNull('$pMrps')] },
        pMfg: { $cond: [IS_SCAN, dmyDate(textOrNull('$sr.predicted.mfd')), toDate(firstNonNull('$pMfgs'))] },
        pExp: { $cond: [IS_SCAN, dmyDate(textOrNull('$sr.predicted.exp')), toDate(firstNonNull('$pExps'))] },
        pBatch: { $cond: [IS_SCAN, textOrNull('$sr.predicted.batch'), firstNonNull('$pBatches')] },
        grnEdited: { $ifNull: ['$sr.grn.edited', false] },
        grnRaw: { $ifNull: ['$sr.grn', null] },
        approvalRaw: { $ifNull: ['$sr.approval', null] },
        metaStatus: { $eq: ['$sr.metadata_status', true] },
        grnStatus: { $eq: ['$sr.grn_status', true] },
        approved: { $or: [{ $eq: ['$sr.metadata_status', true] }, { $eq: ['$sr.grn_status', true] }] },
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
  return [
    ...rowStages(envIds, f),
    ...searchStage(f.q),
    ...drillStage(f),
    ...(f.grnEdited ? [{ $match: { grnEdited: true } }] : []),
    ...(f.approved ? [{ $match: { approved: true } }] : []),
  ];
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
  const predicted = metaOf({ mrp: r.pMrp, mfg: r.pMfg, exp: r.pExp, batch: r.pBatch });
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

/** Scan best_images → [{ url, fields }] (fields = mrp | batch | mfd | exp shown on that photo). */
const imagesOf = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((i) => i && typeof i.url === 'string' && i.url)
    .map((i) => ({ url: i.url, fields: Array.isArray(i.fields) ? i.fields.map(String) : [] }));

/** users.id → display name (scan edited_by holds the user id). Cached 1 min. */
let namesCache = null;
async function userNames() {
  if (namesCache && Date.now() - namesCache.at < ACCESS_TTL_MS) return namesCache.map;
  const docs = await col('users').find({ id: { $exists: true } }, { projection: { _id: 0, id: 1, name: 1, email: 1 } }).toArray();
  const map = new Map(docs.map((u) => [String(u.id), String(u.name || u.email || u.id)]));
  namesCache = { at: Date.now(), map };
  return map;
}

/** GRN upload → DTO metadata shape (dates already ISO). null = no GRN data. */
const grnMeta = (g) =>
  g?.submitted_data
    ? metaOf({
        mrp: g.submitted_data.mrp,
        mfg: g.submitted_data.mfd ? new Date(`${g.submitted_data.mfd}T00:00:00Z`) : null,
        exp: g.submitted_data.exp ? new Date(`${g.submitted_data.exp}T00:00:00Z`) : null,
        batch: g.submitted_data.batch,
      })
    : null;

const APPROVE_FIELDS = ['mfgDate', 'expiryDate', 'batchNumber', 'mrp'];
const blankVal = (v) => v == null || v === '';
const normBatch = (v) => String(v).replace(/\s+/g, '').toUpperCase();

/**
 * Per field: was this source right vs the approved values?
 * true = same, false = different (or gave a value where none is on the photo), null = source has no value (not counted).
 */
function marks(final, src) {
  return Object.fromEntries(
    APPROVE_FIELDS.map((k) => {
      if (!src || blankVal(src[k])) return [k, null];
      if (blankVal(final[k])) return [k, false];
      if (k === 'mrp') return [k, Math.abs(Number(final[k]) - Number(src[k])) < 0.01];
      if (k === 'batchNumber') return [k, normBatch(final[k]) === normBatch(src[k])];
      return [k, final[k] === src[k]];
    }),
  );
}

function toDto(r, names) {
  const ts = iso(r.ts)?.toISOString() ?? new Date(0).toISOString();
  const ean = r.ean != null ? String(r.ean) : '';
  const images = r.scan ? imagesOf(r.images) : null;
  const editedBy = r.scan && r.editedBy != null ? (names?.get(String(r.editedBy)) ?? String(r.editedBy)) : r.editedBy;
  const edited = !!(r.scan && iso(r.editedAt));
  const ref = images ? images[0]?.url : r.img;
  return withOutsideEdit({
    id: r._id,
    productName: ean ? `EAN ${ean}` : 'No EAN',
    ean,
    fileName: fileOf(ref),
    imageRef: ref || '',
    metadata: metaOf(r),
    status: r.status,
    version: r.scan ? (edited ? 2 : 1) : Number(r.version) || 1,
    createdAt: ts,
    updatedAt: iso(r.editedAt)?.toISOString() ?? ts,
    updatedBy: editedBy ?? undefined,
    history: Array.isArray(r.history) ? r.history : [],
    // Split team owner (name); old / unassigned captures → null.
    assignedTo: r.assignee != null ? (names?.get(String(r.assignee)) ?? String(r.assignee)) : null,
    // New scans only: every best photo + fields it shows; noResult = no session_results yet (not editable).
    ...(images ? { images, noResult: !!r.noResult } : {}),
    // Model = what our model read (predicted), before any edit.
    ...(r.scan && !r.noResult ? { modelData: metaOf({ mrp: r.pMrp, mfg: r.pMfg, exp: r.pExp, batch: r.pBatch }) } : {}),
    approval: (() => {
      const a = r.approvalRaw;
      if (!a?.at || !(r.metaStatus || r.grnStatus)) return null;
      return {
        source: a.source,
        by: a.by != null ? (names?.get(String(a.by)) ?? String(a.by)) : null,
        at: iso(a.at)?.toISOString() ?? null,
        model: a.model ?? null,
        grn: a.grn ?? null,
        // Values changed after approval (SDK / another edit) → needs a new approval.
        stale: !!a.final && diffFields(a.final, metaOf(r)).length > 0,
      };
    })(),
    grnEdited: !!r.grnEdited,
    // Approved side (session_results.metadata_status / grn_status). Values changed since → not approved.
    ...(() => {
      const stale = !!r.approvalRaw?.final && diffFields(r.approvalRaw.final, metaOf(r)).length > 0;
      return { metadataStatus: !!r.metaStatus && !stale, grnStatus: !!r.grnStatus && !stale };
    })(),
    grnData: (() => {
      const g = r.grnRaw;
      if (!g || !g.submitted_data) return null;
      return {
        batch: g.submitted_data.batch ?? null,
        mfd:   g.submitted_data.mfd   ?? null,
        exp:   g.submitted_data.exp   ?? null,
        mrp:   g.submitted_data.mrp   ?? null,
        batchChanged: !!g.batch_changed,
        mfdChanged:   !!g.mfd_changed,
        expChanged:   !!g.exp_changed,
        mrpChanged:   !!g.mrp_changed,
      };
    })(),
  }, r);
}

/** Rows → DTOs (resolves scan editor ids to names only when needed). */
async function toDtos(rows) {
  const names = rows.some((r) => (r.scan && r.editedBy != null) || r.assignee != null || r.approvalRaw) ? await userNames() : null;
  return rows.map((r) => toDto(r, names));
}

async function getRow(envId) {
  const [row] = await col('metadata').aggregate([{ $match: { env_id: envId } }, ...rowStages()]).toArray();
  return row ? (await toDtos([row]))[0] : null;
}

/** Edited captures only (dashboard history or outside edit) in scope + capture range + search → DTOs. */
async function editedRows({ from, to, client, q }, user) {
  const envIds = await scopedEnvIds(user.id, { client });
  if (!envIds.length) return [];
  const rows = await col('metadata')
    .aggregate([...rowStages(envIds, { from, to }), ...searchStage(q)], { allowDiskUse: true })
    .toArray();
  return (await toDtos(rows)).filter((d) => d.history.length);
}

/** metadata doc → live event fields. */
const liveDoc = (d) => ({
  id: String(d._id),
  env: d.env_id ?? null,
  ts: (iso(d.timestamp) ?? iso(d.started_at) ?? (d._id instanceof ObjectId ? d._id.getTimestamp() : new Date())).toISOString(),
  ean: d.ean != null ? String(d.ean) : '',
  batch: d.batch_no != null ? String(d.batch_no) : '',
  // New scans are complete when written (may have no photo) → announce right away.
  hasImage: !!d.img_url || !!d.started_at,
});
const LIVE_PROJECTION = { env_id: 1, timestamp: 1, started_at: 1, img_url: 1, ean: 1, batch_no: 1 };

// ── New-scan edits (session_results) ─────────────────────────────────────
const SCAN_KEY = { batch: 'batch', mrp: 'mrp', mfd: 'mfd', expiry: 'exp' };
const DMY_SEP = /\d([-/.])\d/;

/** ISO "2026-07-01" → "01-07-2026" (separator copied from the scan's own dates). */
const dmyText = (isoDay, sep) => isoDay.split('-').reverse().join(sep);

/** MRP number → text with at least as many decimals as the scan's own value ("105.0", "625.00"). */
const mrpText = (n, sample) => {
  const want = String(sample ?? '').match(/\.(\d+)$/)?.[1].length ?? 2;
  const need = String(n).split('.')[1]?.length ?? 0;
  return n.toFixed(Math.max(want, need));
};

/**
 * Dashboard edit of a new scan → session_results only (metadata untouched).
 * Fields changed vs what is shown now go into edited_values in the scan's own text style;
 * other edited_values (e.g. SDK edits) stay. edited = true, edited_by = user id, updated_at = now.
 */
async function updateScan(id, latest, cur, metadata, user) {
  const sr = await col('session_results').findOne({ metadata_id: latest._id });
  if (!sr) throw new HttpError(409, "No result saved for this scan yet — it can't be edited");
  const pred = sr.predicted ?? {};
  const shown = { ...pred, ...(sr.edited_values ?? {}) };
  const sample = [pred.mfd, pred.exp, shown.mfd, shown.exp].map((v) => String(v ?? '')).find((v) => DMY_SEP.test(v)) ?? '';
  const sep = sample.match(DMY_SEP)?.[1] ?? '-';
  const text = {
    // Cleared field (not on photo) → "N/A", same as the scan engine writes.
    batch: metadata.batchNumber || 'N/A',
    mrp: metadata.mrp == null ? 'N/A' : mrpText(metadata.mrp, pred.mrp ?? shown.mrp),
    mfd: metadata.mfgDate ? dmyText(metadata.mfgDate, sep) : 'N/A',
    exp: metadata.expiryDate ? dmyText(metadata.expiryDate, sep) : 'N/A',
  };
  const changed = diffFields(cur.metadata, metadata);
  if (!changed.length) return cur;
  const editedValues = { ...(sr.edited_values ?? {}) };
  for (const k of changed) editedValues[SCAN_KEY[k]] = text[SCAN_KEY[k]];
  const res = await col('session_results').updateOne(
    { _id: sr._id, updated_at: sr.updated_at ?? null }, // optimistic lock
    { $set: { edited_values: editedValues, edited: true, edited_by: user.id, updated_at: new Date() } },
  );
  if (!res.matchedCount) throw new HttpError(409, 'Capture changed meanwhile — reload and retry');
  return getRow(id);
}

/** Latest recapture of a new scan (single sort key: Cosmos ignores 2nd keys on ties). null = old capture. */
const latestScanOf = (envId) =>
  col('metadata').findOne({ env_id: envId, started_at: { $exists: true } }, { sort: { started_at: -1 }, projection: { _id: 1 } });

/**
 * Approval of a new scan → session_results.approval:
 * source (model | grn | edited), who, when, final values, and per field whether Model / GRN were right.
 */
function approvalDoc(row, source, byId, grnRaw, firstAt) {
  const grnVals = grnMeta(grnRaw);
  const now = new Date();
  return {
    source,
    by: byId,
    at: now,
    // First approval time: keeps a capture's place in the accuracy 200-groups when re-approved.
    first_at: firstAt ?? now,
    final: row.metadata,
    model: marks(row.metadata, row.modelData),
    grn: grnVals ? marks(row.metadata, grnVals) : null,
  };
}

/** Which side was approved → session_results.metadata_status / grn_status. auto = both (values = GRN). */
const STATUS_OF = {
  metadata: { metadata_status: true, grn_status: false },
  grn: { metadata_status: false, grn_status: true },
  auto: { metadata_status: true, grn_status: true },
};

/**
 * Approval of a new scan → session_results: metadata_status / grn_status + approval
 * (source metadata | grn | auto, who (null = automatic), when, final values, per field whether Model / GRN were right).
 */
async function writeApproval(scan, row, source, user, grnRaw) {
  const prev = await col('session_results').findOne({ metadata_id: scan._id }, { projection: { 'approval.first_at': 1 } });
  await col('session_results').updateOne(
    { metadata_id: scan._id },
    { $set: { ...STATUS_OF[source], approval: approvalDoc(row, source, user?.id ?? null, grnRaw, prev?.approval?.first_at) } },
  );
  scheduleAccuracy(row.id);
  return getRow(row.id);
}

/** Values changed after approval → not approved any more (both statuses false, approval removed). */
async function clearApproval(scan, envId) {
  const res = await col('session_results').updateOne(
    { metadata_id: scan._id, $or: [{ metadata_status: true }, { grn_status: true }, { approval: { $exists: true } }] },
    { $set: { metadata_status: false, grn_status: false }, $unset: { approval: '' } },
  );
  if (res.modifiedCount) scheduleAccuracy(envId);
}

/** Same value? Blank + blank = same. MRP ±0.01, batch ignores spaces / case. */
const sameVal = (k, a, b) => {
  if (blankVal(a) || blankVal(b)) return blankVal(a) && blankVal(b);
  if (k === 'mrp') return Math.abs(Number(a) - Number(b)) < 0.01;
  if (k === 'batchNumber') return normBatch(a) === normBatch(b);
  return a === b;
};

/** Shown values = GRN values on all 4 fields → auto approve. */
const sameAsGrn = (metadata, grnVals) => !!grnVals && APPROVE_FIELDS.every((k) => sameVal(k, metadata[k], grnVals[k]));

/** GRN on top of current values: GRN blanks keep the current value. */
const withGrn = (metadata, grnVals) =>
  Object.fromEntries(APPROVE_FIELDS.map((k) => [k, blankVal(grnVals[k]) ? metadata[k] : grnVals[k]]));

// ── Accuracy (approved GRN-edited captures) ─────────────────────────────
/** Approved now: a status is true and values did not change since (SDK edit → not approved). */
const isApprovedRow = (r) =>
  (r.metaStatus || r.grnStatus) && !!r.approvalRaw?.final && !diffFields(r.approvalRaw.final, metaOf(r)).length;

/** Raw row → lib/accuracy item. */
function accuracyItem(r, client, names) {
  const a = r.approvalRaw;
  return {
    id: r._id,
    ean: r.ean != null ? String(r.ean) : '',
    client,
    at: iso(a.at)?.toISOString() ?? null,
    firstAt: iso(a.first_at ?? a.at)?.toISOString() ?? null,
    by: a.by != null ? (names?.get(String(a.by)) ?? String(a.by)) : 'Auto',
    truth: a.final,
    model: metaOf({ mrp: r.pMrp, mfg: r.pMfg, exp: r.pExp, batch: r.pBatch }),
    grn: grnMeta(r.grnRaw),
    changed: r.grnRaw
      ? {
          batchChanged: !!r.grnRaw.batch_changed,
          mfdChanged: !!r.grnRaw.mfd_changed,
          expChanged: !!r.grnRaw.exp_changed,
          mrpChanged: !!r.grnRaw.mrp_changed,
        }
      : null,
  };
}

/**
 * `accuracy` collection: per client, every 200 approved GRN-edited captures (in first-approval order) = 1 doc
 * { client, seq, size, complete, first_approved_at, last_approved_at, captures, groups, wins, updated_at }.
 * Last doc of a client holds the rest (< 200, complete false) and fills up. Rebuilt per client after changes
 * (approve / edit / GRN upload), so a changed capture updates its group. Summary only: rebuildable any time.
 */
const ACC_CHUNK = 200;
const ACC_DEBOUNCE_MS = 10_000;
const accTimers = new Map(); // client → timeout
let accIndexReady = false;

async function rebuildAccuracy(client) {
  if (!accIndexReady) {
    await col('accuracy').createIndex({ client: 1, seq: 1 }, { unique: true });
    accIndexReady = true;
  }
  const envs = (await scanEnvs()).filter((x) => x.client === client).map((x) => x.env);
  const rows = envs.length
    ? await col('metadata').aggregate(rowStages(envs), { allowDiskUse: true }).toArray()
    : [];
  const items = rows
    .filter((r) => r.scan && !r.noResult && r.grnEdited && isApprovedRow(r))
    .map((r) => accuracyItem(r, client, null))
    .sort((a, b) => String(a.firstAt).localeCompare(String(b.firstAt)) || String(a.id).localeCompare(String(b.id)));
  const now = new Date();
  const ops = [];
  for (let i = 0, seq = 1; i < items.length; i += ACC_CHUNK, seq += 1) {
    const part = items.slice(i, i + ACC_CHUNK);
    const rep = computeAccuracy(part);
    const keep = ['ALL', 'EDITED', 'NOT_EDITED'];
    ops.push({
      replaceOne: {
        filter: { client, seq },
        replacement: {
          client,
          seq,
          size: part.length,
          complete: part.length === ACC_CHUNK,
          first_approved_at: new Date(part[0].firstAt),
          last_approved_at: new Date(part[part.length - 1].firstAt),
          captures: part.map((x) => x.id),
          groups: Object.fromEntries(keep.filter((k) => rep.groups[k]).map((k) => [k, rep.groups[k]])),
          wins: rep.wins,
          updated_at: now,
        },
        upsert: true,
      },
    });
  }
  if (ops.length) await col('accuracy').bulkWrite(ops, { ordered: false });
  await col('accuracy').deleteMany({ client, seq: { $gt: ops.length } });
  return { client, groups: ops.length, captures: items.length };
}

/** Rebuild that capture's client's accuracy docs a little later (many clicks / one upload → one rebuild). */
function scheduleAccuracy(envIdOrClient, { isClient = false } = {}) {
  const run = async () => {
    const client = isClient ? envIdOrClient : (await scanEnvs()).find((x) => x.env === envIdOrClient)?.client;
    if (client == null) return;
    clearTimeout(accTimers.get(client));
    accTimers.set(
      client,
      setTimeout(() => {
        accTimers.delete(client);
        rebuildAccuracy(client).catch((e) => console.error('[accuracy] rebuild failed', client, e.message));
      }, ACC_DEBOUNCE_MS),
    );
  };
  run().catch((e) => console.error('[accuracy] schedule failed', e.message));
}

/**
 * Auto approve after a GRN upload (or backfill): shown values = GRN on all 4 fields → both statuses (source auto).
 * Captures a person approved stay as they are. An earlier auto approval that no longer matches is removed.
 * → { autoApproved, cleared }
 */
async function autoApproveEnvs(envIds, { dry = false } = {}) {
  if (!envIds.length) return { autoApproved: 0, cleared: 0 };
  const rows = await col('metadata').aggregate(rowStages(envIds), { allowDiskUse: true }).toArray();
  const ops = [];
  const touched = new Set();
  let autoApproved = 0;
  let cleared = 0;
  for (const r of rows) {
    if (!r.scan || r.noResult || !r.scanId) continue;
    const metadata = metaOf(r);
    const g = grnMeta(r.grnRaw);
    const src = r.approvalRaw?.source;
    const approvedNow = isApprovedRow(r);
    if (approvedNow && src !== 'auto') continue; // person approved → keep
    if (sameAsGrn(metadata, g)) {
      if (approvedNow) continue; // already auto approved with these values
      const row = { metadata, modelData: metaOf({ mrp: r.pMrp, mfg: r.pMfg, exp: r.pExp, batch: r.pBatch }) };
      ops.push({
        updateOne: {
          filter: { metadata_id: r.scanId },
          update: { $set: { ...STATUS_OF.auto, approval: approvalDoc(row, 'auto', null, r.grnRaw, r.approvalRaw?.first_at) } },
        },
      });
      autoApproved += 1;
      touched.add(r._id);
    } else if (src === 'auto' || r.metaStatus || r.grnStatus) {
      ops.push({
        updateOne: {
          filter: { metadata_id: r.scanId },
          update: { $set: { metadata_status: false, grn_status: false }, $unset: { approval: '' } },
        },
      });
      cleared += 1;
      touched.add(r._id);
    }
  }
  if (dry) return { autoApproved, cleared, dry: true };
  for (let i = 0; i < ops.length; i += 500) await col('session_results').bulkWrite(ops.slice(i, i + 500), { ordered: false });
  if (touched.size) {
    const clientOf = new Map((await scanEnvs()).map((x) => [x.env, x.client]));
    for (const c of new Set([...touched].map((e) => clientOf.get(e)).filter((c) => c != null))) scheduleAccuracy(c, { isClient: true });
  }
  return { autoApproved, cleared };
}

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
          { projection: LIVE_PROJECTION },
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
        .find({ _id: { $in: ids.map((i) => new ObjectId(i)) } }, { projection: LIVE_PROJECTION })
        .toArray();
      return docs.map(liveDoc);
    },

    /** env_id → access keys ["client:<key>"] ('' = no client). Missing env = not in map. */
    async storesOf(envIds) {
      const map = new Map();
      if (!envIds.length) return map;
      const [rows, scans] = await Promise.all([
        col('environment').find({ env_id: { $in: envIds } }, { projection: { _id: 0, env_id: 1, client_name: 1 } }).toArray(),
        // New scans carry their own client.
        col('metadata')
          .find({ env_id: { $in: envIds }, started_at: { $exists: true } }, { projection: { _id: 0, env_id: 1, client: 1 } })
          .toArray(),
      ]);
      for (const r of rows) map.set(r.env_id, [`client:${clientKey(r.client_name)}`]);
      for (const r of scans) if (!map.has(r.env_id)) map.set(r.env_id, [`client:${clientKey(r.client)}`]);
      return map;
    },

    /**
     * Value fingerprints of metadata docs inserted since `sinceMs`, newest first (by _id → default index).
     * Compared tick to tick → edits by any app (SDK, main app, this dashboard) and deletions.
     */
    async prints(sinceMs, limit) {
      const since = { _id: { $gte: ObjectId.createFromTime(Math.floor(sinceMs / 1000)) } };
      const [docs, results] = await Promise.all([
        col('metadata')
          .find(since, {
            projection: { env_id: 1, mrp: 1, mfg_date: 1, expiry_date: 1, batch_no: 1, ean: 1, annotation_version: 1, img_url: 1, result_id: 1 },
          })
          .sort({ _id: -1 })
          .limit(limit)
          .toArray(),
        // New scans are edited in session_results (SDK /update_data + this dashboard).
        col('session_results')
          .find(since, { projection: { env_id: 1, predicted: 1, edited_values: 1, edited_by: 1, updated_at: 1 } })
          .sort({ _id: -1 })
          .limit(limit)
          .toArray(),
      ]);
      return [
        ...docs.map((d) => ({
          id: String(d._id),
          env: d.env_id ?? null,
          hash: JSON.stringify([d.mrp, d.mfg_date, d.expiry_date, d.batch_no, d.ean, d.annotation_version, d.img_url, d.result_id]),
        })),
        ...results.map((d) => ({
          id: String(d._id),
          env: d.env_id ?? null,
          hash: JSON.stringify([d.predicted, d.edited_values, d.edited_by, d.updated_at]),
        })),
      ]
        .sort((a, b) => b.id.localeCompare(a.id))
        .slice(0, limit);
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
      const { clientKeys, member, envSet } = await scope(user.id);
      if (member) return events.filter((e) => envSet.has(e.env)); // split team: shared old + own
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
      return { items: await toDtos(res.items), total: counts[status], counts };
    },

    /** Captures per IST day in [from, to] + latest day with data — calendar dots. */
    async dayCounts({ from, to, ...f }, user) {
      const envIds = await scopedEnvIds(user.id, f);
      if (!envIds.length) return { days: [], latest: null };
      const [res] = await col('metadata')
        .aggregate(
          [
            ...tsStages(envIds),
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
      let latestTs = res.latest[0]?.ts;
      // Split team member: open on the latest day with captures assigned to THEM (not shared ones).
      if ((await scope(user.id)).member) {
        const own = await owners();
        const mine = envIds.filter((e) => own.get(e) === String(user.id));
        if (mine.length) {
          const [r] = await col('metadata')
            .aggregate([...tsStages(mine), { $sort: { ts: -1 } }, { $limit: 1 }], { allowDiskUse: true })
            .toArray();
          if (r?.ts) latestTs = r.ts;
        }
      }
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
      // Scans without a result have no values to compare → left out of stats.
      const stats = computeEditStats((await toDtos(rows)).filter((d) => !d.noResult), { detail });
      if (detail && stats.rows?.length) await addScanTimings(stats.rows);
      return stats;
    },

    /** Accuracy page: approved new scans in [from, to] → Model / GRN vs approved values (lib/accuracy.js). */
    async accuracy({ from, to, client }, user) {
      const envIds = await scopedEnvIds(user.id, { client });
      if (!envIds.length) return computeAccuracy([], { total: 0 });
      const [rows, s] = await Promise.all([
        col('metadata').aggregate(rowStages(envIds, { from, to }), { allowDiskUse: true }).toArray(),
        scope(user.id),
      ]);
      // GRN-edited captures only (user decision 2026-11-28).
      const pool = rows.filter((r) => r.scan && !r.noResult && r.grnEdited);
      const approved = pool.filter(isApprovedRow);
      const names = approved.length ? await userNames() : null;
      const clientOf = new Map(s.rows.map((x) => [x.env, x.client]));
      return computeAccuracy(approved.map((r) => accuracyItem(r, clientOf.get(r._id) ?? '', names)), { total: pool.length });
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

    /**
     * Approve a new scan. 'metadata' → values as shown are final (metadata_status).
     * 'grn' → GRN values written into the scan (blank GRN fields keep the current value), then final (grn_status).
     * Values then equal GRN on all fields → both statuses (source auto).
     */
    async approve(id, source, user) {
      await assertCanAccess(user.id, id);
      const cur = await getRow(id);
      if (!cur) return null;
      const scan = await latestScanOf(id);
      if (!scan || cur.noResult) throw new HttpError(409, 'Only new scans with a saved result can be approved');
      const sr = await col('session_results').findOne({ metadata_id: scan._id }, { projection: { grn: 1 } });
      const g = grnMeta(sr?.grn);
      let values = cur.metadata;
      if (source === 'grn') {
        if (!g) throw new HttpError(409, 'No GRN data for this capture');
        values = withGrn(cur.metadata, g);
      }
      const row = diffFields(cur.metadata, values).length ? await updateScan(id, scan, cur, values, user) : cur;
      return writeApproval(scan, row, sameAsGrn(row.metadata, g) ? 'auto' : source, user, sr?.grn);
    },

    async update(id, metadata, user) {
      await assertCanAccess(user.id, id);
      const cur = await getRow(id);
      if (!cur) return null;
      // New scan → edit its latest recapture's session_results. Changed values → not approved any more,
      // unless they now match GRN on all fields (auto approve).
      const scan = await latestScanOf(id);
      if (scan) {
        if (!diffFields(cur.metadata, metadata).length) return cur;
        const row = await updateScan(id, scan, cur, metadata, user);
        const sr = await col('session_results').findOne({ metadata_id: scan._id }, { projection: { grn: 1 } });
        if (sameAsGrn(row.metadata, grnMeta(sr?.grn))) return writeApproval(scan, row, 'auto', null, sr?.grn);
        await clearApproval(scan, id);
        return getRow(id);
      }
      const [latest] = await col('metadata').find({ env_id: id }).sort({ timestamp: -1 }).limit(1).toArray();
      const now = new Date();
      const updated = await col('metadata').findOneAndUpdate(
        { _id: latest._id, annotation_version: latest.annotation_version ?? null }, // optimistic lock
        {
          $set: {
            // Blank field = not on photo → null.
            mfg_date: metadata.mfgDate ? new Date(`${metadata.mfgDate}T00:00:00Z`) : null,
            expiry_date: metadata.expiryDate ? new Date(`${metadata.expiryDate}T00:00:00Z`) : null,
            batch_no: metadata.batchNumber || null,
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

  sessionResults: {
    /**
     * Write GRN revalidation data from the "OCR vs GRN" Excel sheet into session_results.
     * For each request_id finds the latest metadata doc (latest recapture), then updates
     * the matching session_results doc under a `grn` sub-key. Idempotent on re-upload.
     */
    async upsertGrnData(records) {
      if (!records.length) return { inserted: 0, updated: 0, skipped: 0 };

      const requestIds = records.map((r) => r.request_id);

      // Find the latest metadata doc per request_id (there may be multiple recaptures).
      const metadataDocs = await col('metadata')
        .find(
          { request_id: { $in: requestIds }, started_at: { $exists: true } },
          { projection: { _id: 1, env_id: 1, request_id: 1, started_at: 1, is_recapture: 1 } },
        )
        .sort({ is_recapture: -1, started_at: -1 }) // recapture wins; latest wins among ties
        .toArray();

      // Keep the first (highest-priority) _id per request_id.
      const latestMetaId = new Map();
      for (const doc of metadataDocs) {
        const reqId = String(doc.request_id);
        if (!latestMetaId.has(reqId)) latestMetaId.set(reqId, doc._id);
      }

      if (!latestMetaId.size) return { inserted: 0, updated: 0, skipped: records.length };

      const recordByReqId = new Map(records.map((r) => [r.request_id, r]));
      const now = new Date();
      const startedOf = new Map(metadataDocs.map((d) => [String(d._id), d.started_at]));
      const dayCounts = new Map(); // IST capture day → captures that got GRN

      const ops = [];
      for (const [reqId, metadataId] of latestMetaId) {
        const r = recordByReqId.get(reqId);
        if (!r) continue;
        const t = startedOf.get(String(metadataId));
        const day = t instanceof Date && !Number.isNaN(t.getTime()) ? istDay(t) : 'unknown';
        dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
        const { request_id, ...grnFields } = r;
        ops.push({
          updateOne: {
            filter: { metadata_id: metadataId },
            update: { $set: { grn: { ...grnFields, uploaded_at: now } } },
          },
        });
      }

      if (!ops.length) return { inserted: 0, updated: 0, skipped: records.length };

      const result = await col('session_results').bulkWrite(ops, { ordered: false });
      // Values = GRN on all fields → approved automatically.
      const envIds = [...new Set(metadataDocs.filter((d) => recordByReqId.has(String(d.request_id))).map((d) => d.env_id).filter(Boolean))];
      const { autoApproved } = await autoApproveEnvs(envIds);
      return {
        inserted: 0,
        updated: result.modifiedCount,
        skipped: records.length - latestMetaId.size,
        autoApproved,
        // Capture day (IST) of the captures that got GRN data, oldest first.
        byDay: [...dayCounts].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
      };
    },

    /**
     * One-off backfill: old approvals → metadata_status / grn_status, then auto approve every capture with GRN,
     * then rebuild all accuracy docs.
     */
    async backfillApprovals({ dry = false } = {}) {
      const ids = (await col('session_results').find({ grn: { $exists: true } }, { projection: { metadata_id: 1 } }).toArray()).map((d) => d.metadata_id);
      const envIds = [];
      for (let i = 0; i < ids.length; i += 1000) {
        const docs = await col('metadata').find({ _id: { $in: ids.slice(i, i + 1000) } }, { projection: { env_id: 1 } }).toArray();
        envIds.push(...docs.map((d) => d.env_id).filter(Boolean));
      }
      if (dry) {
        const oldCount = await col('session_results').countDocuments({ approval: { $exists: true }, metadata_status: { $exists: false } });
        return { converted: oldCount, ...(await autoApproveEnvs([...new Set(envIds)], { dry: true })) };
      }
      const old = await col('session_results')
        .find({ approval: { $exists: true }, metadata_status: { $exists: false } }, { projection: { 'approval.source': 1, 'approval.at': 1 } })
        .toArray();
      for (const d of old) {
        const st = d.approval?.source === 'grn' ? STATUS_OF.grn : STATUS_OF.metadata;
        await col('session_results').updateOne(
          { _id: d._id },
          { $set: { ...st, 'approval.source': d.approval?.source === 'grn' ? 'grn' : 'metadata', 'approval.first_at': d.approval?.at ?? new Date() } },
        );
      }
      const auto = await autoApproveEnvs([...new Set(envIds)]);
      const clients = [...new Set((await scanEnvs()).map((x) => x.client))];
      const rebuilt = [];
      for (const c of clients) rebuilt.push(await rebuildAccuracy(c));
      return { converted: old.length, ...auto, accuracy: rebuilt.filter((r) => r.groups) };
    },
  },
};

