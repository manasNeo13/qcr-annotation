import { Router } from 'express';
import { HttpError, notFound } from '../lib/httpError.js';
import {
  daysQuerySchema,
  editedQuerySchema,
  listQuerySchema,
  neighborsQuerySchema,
  parse, statsQuerySchema,
  updateBodySchema,
} from '../lib/validation.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePerm } from '../middleware/permissions.js';
import { VIEW_PERMISSIONS } from '../lib/permissions.js';
import { repo } from '../repos/index.js';
import { onNewCaptures } from '../services/live.js';
import { signBlobUrl } from '../services/sas.js';

const router = Router();
router.use(requireAuth);
const canView = requirePerm(...VIEW_PERMISSIONS);

/** Repo DTO → API DocumentItem (frontend/src/types). id = env_id in mongo mode. */
const present = ({ imageRef, images, ...d }) => ({
  ...d,
  imageUrl: signBlobUrl(imageRef),
  // New scans: every best photo (signed) + the fields read from it.
  ...(images ? { images: images.map((i) => ({ url: signBlobUrl(i.url), fields: i.fields })) } : {}),
});

router.get('/', requirePerm('view_documents'), async (req, res) => {
  const query = parse(listQuerySchema, req.query);
  const { items, total, counts } = await repo.documents.list(query, req.user);
  res.json({ items: items.map(present), total, page: query.page, pageSize: query.pageSize, counts });
});

/** Calendar dots: captures per IST day in [from, to] + latest day with data. */
router.get('/dates', canView, async (req, res) => {
  const f = parse(daysQuerySchema, req.query);
  res.json(await repo.documents.dayCounts(f, req.user));
});

/** Scope dropdown: clients (user-scoped). */
router.get('/filters', canView, async (req, res) => {
  res.json(await repo.documents.filterOptions(req.user));
});

/** Edit stats: OCR values changed by annotators, per field / day / annotator (capture day, IST). */
router.get('/stats', requirePerm('view_stats'), async (req, res, next) => {
  const f = parse(statsQuerySchema, req.query);
  // detail rows = CSV export only.
  if (f.detail && !req.access.permissions.includes('export_csv')) return next(new HttpError(403, "You don't have access to export"));
  res.json(await repo.documents.editStats(f, req.user));
});

/** Accuracy: Model / GRN vs approved values (approved captures only, capture day IST). */
router.get('/accuracy', requirePerm('view_accuracy'), async (req, res) => {
  const f = parse(statsQuerySchema, req.query);
  res.json(await repo.documents.accuracy(f, req.user));
});

/**
 * Edit stats drill-down: captures (capture day in range) where `changed` field was edited,
 * optionally by `editor`. Same rules as /stats → counts match. Items carry `edit` (original, changed, editors).
 */
router.get('/edited', requirePerm('view_stats'), async (req, res) => {
  const query = parse(editedQuerySchema, req.query);
  const { items, total, counts } = await repo.documents.edited(query, req.user);
  res.json({ items: items.map(present), total, page: query.page, pageSize: query.pageSize, counts });
});

/** Annotation drill-down: EAN groups, then batch groups inside an EAN. */
router.get('/groups/:by', requirePerm('view_annotation'), async (req, res) => {
  if (!['ean', 'batch'].includes(req.params.by)) throw notFound('Group');
  const query = parse(listQuerySchema, req.query);
  const out = await repo.documents.groups(req.params.by, query, req.user);
  res.json({ ...out, page: query.page, pageSize: query.pageSize });
});

/**
 * Ordered id lists per user + filter, cached briefly → stepping through captures
 * (and frontend prefetch of next/prev neighbors) doesn't re-run the aggregation each time.
 * Cleared on every save so status/edit changes show up immediately.
 */
const IDS_TTL_MS = 60_000;
const idsCache = new Map(); // key → { at, ids: Promise<string[]> }
onNewCaptures(() => idsCache.clear()); // new captures shift prev/next order
async function orderedIdsFor(filter, user) {
  const key = `${user.id}|${JSON.stringify(filter)}`;
  const hit = idsCache.get(key);
  if (hit && Date.now() - hit.at < IDS_TTL_MS) return hit.ids;
  const ids = filter.changed
    ? repo.documents.editedIds(filter, user)
    : repo.documents.orderedIds(filter, user);
  idsCache.set(key, { at: Date.now(), ids });
  ids.catch(() => idsCache.delete(key));
  if (idsCache.size > 200) idsCache.delete(idsCache.keys().next().value);
  return ids;
}

/** Prev/next within the current list filter. */
router.get('/:id/neighbors', canView, async (req, res) => {
  const { page: _p, pageSize: _s, ...filter } = parse(neighborsQuerySchema, req.query);
  const ids = await orderedIdsFor(filter, req.user);
  const i = ids.indexOf(req.params.id);
  res.json({
    prevId: i > 0 ? ids[i - 1] : null,
    nextId: i >= 0 && i < ids.length - 1 ? ids[i + 1] : null,
    index: i, // -1 = not in this filter (e.g. status changed after edit)
    total: ids.length,
  });
});

/**
 * Serial number → capture id. No. 1 = OLDEST in the filter, so numbers stay put when new captures
 * arrive on top (newest-first list). GET /documents/at?n=501&<list filter>
 */
router.get('/at', canView, async (req, res) => {
  const { n: raw, ...q } = req.query;
  const n = Number(raw);
  const { page: _p, pageSize: _s, ...filter } = parse(neighborsQuerySchema, q);
  const ids = await orderedIdsFor(filter, req.user);
  if (!Number.isInteger(n) || n < 1 || n > ids.length) {
    throw new HttpError(404, ids.length ? `Enter a number from 1 to ${ids.length}` : 'No captures in this list');
  }
  res.json({ id: ids[ids.length - n], total: ids.length });
});

router.get('/:id', canView, async (req, res) => {
  const doc = await repo.documents.get(req.params.id, req.user);
  if (!doc) throw notFound('Document');
  res.json(present(doc));
});

router.patch('/:id', requirePerm('edit_capture'), async (req, res) => {
  const { metadata } = parse(updateBodySchema, req.body ?? {});
  const doc = await repo.documents.update(req.params.id, metadata, req.user);
  idsCache.clear();
  if (!doc) throw notFound('Document');
  res.json(present(doc));
});

const APPROVE_SOURCES = ['metadata', 'grn'];

/** Approve a capture: metadata (values as shown) or grn (GRN values written in). Sets metadata_status / grn_status. */
router.post('/:id/approve', requirePerm('edit_capture'), async (req, res) => {
  const source = req.body?.source;
  if (!APPROVE_SOURCES.includes(source)) throw new HttpError(400, 'source must be metadata or grn');
  if (!repo.documents.approve) throw new HttpError(501, 'Approve needs the Mongo data source');
  const doc = await repo.documents.approve(req.params.id, source, req.user);
  idsCache.clear();
  if (!doc) throw notFound('Document');
  res.json(present(doc));
});

export default router;
