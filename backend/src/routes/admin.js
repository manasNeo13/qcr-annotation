import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { HttpError } from '../lib/httpError.js';
import { PERMISSIONS } from '../lib/permissions.js';
import { parse } from '../lib/validation.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePerm } from '../middleware/permissions.js';

/** User management: users (shared with main app), role permission matrix, change log. manage_users only. */
const router = Router();
router.use(requireAuth, requirePerm('manage_users'));

const admin = env.DATA_SOURCE === 'mongo' ? await import('../repos/admin.js') : null;
router.use((_req, _res, next) => next(admin ? undefined : new HttpError(501, 'User management needs the Mongo data source')));

const PAGE = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(15) };

const listUsersSchema = z.object({
  ...PAGE,
  q: z.string().trim().max(100).optional().default(''),
  role: z.string().trim().max(100).optional(), // role key; '' = No role; missing = all
  status: z.enum(['all', 'active', 'inactive']).optional().default('all'),
});

const userBody = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    email: z.union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email')]).default(''),
    phone: z
      .string()
      .trim()
      .max(20)
      .regex(/^[0-9+\- ]*$/, 'Digits, +, - and spaces only')
      .default(''),
    role: z.string().trim().max(100).default(''),
    active: z.boolean().default(true),
    stores: z.array(z.string().trim().min(1).max(50)).max(500).default([]),
  })
  .strict();
const createUserBody = userBody.extend({
  id: z
    .string()
    .trim()
    .min(2, 'User ID is required')
    .max(40)
    .regex(/^[A-Za-z0-9_.-]+$/, 'Letters, numbers, _ . - only'),
});

const perms = z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length);
const roleBody = z.object({ name: z.string().trim().min(1, 'Role name is required').max(50), permissions: perms }).strict();
const roleUpdateBody = z.object({ permissions: perms }).strict();

const by = (req) => ({ id: req.user.id, name: req.user.name || req.user.email });

router.get('/users', async (req, res) => {
  const q = parse(listUsersSchema, req.query);
  res.json({ ...(await admin.listUsers(q)), page: q.page, pageSize: q.pageSize });
});
router.post('/users', async (req, res) => {
  res.status(201).json(await admin.createUser(parse(createUserBody, req.body ?? {}), by(req)));
});
router.patch('/users/:key', async (req, res) => {
  res.json(await admin.updateUser(req.params.key, parse(userBody, req.body ?? {}), by(req)));
});

router.get('/stores', async (_req, res) => res.json(await admin.storeOptions()));

router.get('/roles', async (_req, res) => res.json({ permissions: PERMISSIONS, roles: await admin.listRoles() }));
router.post('/roles', async (req, res) => {
  res.status(201).json(await admin.createRole(parse(roleBody, req.body ?? {}), by(req)));
});
// key '' (No role) addressed as "~none".
const roleParam = (k) => (k === '~none' ? '' : decodeURIComponent(k));
router.put('/roles/:key', async (req, res) => {
  const { permissions } = parse(roleUpdateBody, req.body ?? {});
  res.json(await admin.updateRolePermissions(roleParam(req.params.key), permissions, by(req)));
});
router.delete('/roles/:key', async (req, res) => res.json(await admin.deleteRole(roleParam(req.params.key), by(req))));

router.get('/audit', async (req, res) => {
  const q = parse(z.object(PAGE), req.query);
  res.json({ ...(await admin.listAudit(q)), page: q.page, pageSize: q.pageSize });
});

export default router;
