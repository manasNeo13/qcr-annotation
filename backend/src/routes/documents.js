import { Router } from 'express';
import { notFound } from '../lib/httpError.js';
import { daysQuerySchema, listQuerySchema, parse, updateBodySchema } from '../lib/validation.js';
import { requireAuth } from '../middleware/auth.js';
import { repo } from '../repos/index.js';
import { signBlobUrl } from '../services/sas.js';

const router = Router();
router.use(requireAuth);

/** Repo DTO → API DocumentItem (frontend/src/types). id = env_id in mongo mode. */
const present = ({ imageRef, ...d }) => ({ ...d, imageUrl: signBlobUrl(imageRef) });

router.get('/', async (req, res) => {
  const query = parse(listQuerySchema, req.query);
  const { items, total, counts } = await repo.documents.list(query, req.user);
  res.json({ items: items.map(present), total, page: query.page, pageSize: query.pageSize, counts });
});

/** Calendar dots: captures per IST day in [from, to] + latest day with data. */
router.get('/dates', async (req, res) => {
  const { from, to } = parse(daysQuerySchema, req.query);
  res.json(await repo.documents.dayCounts({ from, to }, req.user));
});

/** Prev/next within the current list filter. */
router.get('/:id/neighbors', async (req, res) => {
  const { q, status, from, to } = parse(listQuerySchema, req.query);
  const ids = await repo.documents.orderedIds({ q, status, from, to }, req.user);
  const i = ids.indexOf(req.params.id);
  res.json({
    prevId: i > 0 ? ids[i - 1] : null,
    nextId: i >= 0 && i < ids.length - 1 ? ids[i + 1] : null,
    index: i, // -1 = not in this filter (e.g. status changed after edit)
    total: ids.length,
  });
});

router.get('/:id', async (req, res) => {
  const doc = await repo.documents.get(req.params.id, req.user);
  if (!doc) throw notFound('Document');
  res.json(present(doc));
});

router.patch('/:id', async (req, res) => {
  const { metadata } = parse(updateBodySchema, req.body ?? {});
  const doc = await repo.documents.update(req.params.id, metadata, req.user);
  if (!doc) throw notFound('Document');
  res.json(present(doc));
});

export default router;
