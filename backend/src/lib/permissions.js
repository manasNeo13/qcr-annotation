/**
 * App permissions (this dashboard only — main QCR app ignores them).
 * Stored per role in `annotation_roles`; roles without a doc get DEFAULT_PERMISSIONS.
 * Mirrors frontend src/utils/permissions.ts.
 */
export const PERMISSIONS = [
  'view_documents', // Filter Table
  'view_annotation', // Annotation drill-down
  'edit_capture', // Save capture values
  'view_stats', // Edit Stats
  'export_csv', // Edit Stats CSV export
  'manage_users', // Users & roles page + change log
];

/** Existing + new roles start with everything except user management. */
export const DEFAULT_PERMISSIONS = PERMISSIONS.filter((p) => p !== 'manage_users');

/** Any of these opens a capture detail page. */
export const VIEW_PERMISSIONS = ['view_documents', 'view_annotation', 'view_stats'];

/** Admin roles: always full access, can't be edited or deleted (no lock-out). Same set as store-scope org-wide roles. */
export const LOCKED_ROLE_KEYS = ['nhq', 'admin', 'organization admin', 'org admin'];

/** Role grouping key: case/space-insensitive; blank / "1" / missing = '' (No role). */
export function roleKey(role) {
  const k = String(role ?? '').trim().toLowerCase();
  return k === '1' ? '' : k;
}

export const NO_ROLE_LABEL = 'No role';
export const isLockedRole = (key) => LOCKED_ROLE_KEYS.includes(key);

/**
 * Super admin = NHQ only. Sees every client (and captures with no client), only one with manage_users.
 * Everyone else (admin roles too) sees only the clients assigned to them (users.clients).
 */
export const SUPER_ADMIN_KEYS = ['nhq'];
export const isSuperAdmin = (key) => SUPER_ADMIN_KEYS.includes(key);

/** Permissions a role may hold (manage_users = super admin only, never granted via role matrix). */
export const ROLE_PERMISSIONS = PERMISSIONS.filter((p) => p !== 'manage_users');

/** Clients assigned to a user doc (users.clients, values = environment.client_name). */
export const clientsOf = (u) =>
  [...new Set((Array.isArray(u?.clients) ? u.clients : []).map((c) => String(c ?? '').trim()).filter(Boolean))];
