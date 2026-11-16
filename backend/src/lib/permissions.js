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
