import { env } from '../config/env.js';
import { HttpError } from '../lib/httpError.js';
import { PERMISSIONS } from '../lib/permissions.js';

const admin = env.DATA_SOURCE === 'mongo' ? await import('../repos/admin.js') : null;

/** Role + permissions of req.user (fresh from DB, 30s cache). Memory demo: everything. */
export async function accessOf(user) {
  if (!admin) return { role: user.role || 'NHQ', roleKey: 'nhq', permissions: [...PERMISSIONS] };
  return admin.permissionsFor(user.id);
}

/** Allow when user has ANY of `perms`. Sets req.access. Run after requireAuth. */
export const requirePerm =
  (...perms) =>
  async (req, _res, next) => {
    try {
      req.access ??= await accessOf(req.user);
      if (!perms.some((p) => req.access.permissions.includes(p))) throw new HttpError(403, "You don't have access to this");
      next();
    } catch (e) {
      next(e);
    }
  };
