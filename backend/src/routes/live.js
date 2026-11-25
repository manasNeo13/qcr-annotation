import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePerm } from '../middleware/permissions.js';
import { poll } from '../services/live.js';

/** Live capture notifications (Filter Table + Annotation pages). */
const router = Router();
router.use(requireAuth, requirePerm('view_documents', 'view_annotation'));
router.get('/events', poll);

export default router;
