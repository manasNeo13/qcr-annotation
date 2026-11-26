import type { RoleInfo } from '../../types';

export const ADMIN_PAGE_SIZE = 15;

/** Query keys. Writes invalidate ['admin'] (all of these). */
export const ADMIN_KEYS = {
  users: ['admin', 'users'] as const,
  roles: ['admin', 'roles'] as const,
  stores: ['admin', 'stores'] as const,
  clients: ['admin', 'clients'] as const,
  audit: ['admin', 'audit'] as const,
  split: ['admin', 'split'] as const,
};

/** Role key → info lookup. */
export const roleMap = (roles: RoleInfo[] = []) => new Map(roles.map((r) => [r.key, r]));
