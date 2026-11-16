/** Mirrors backend lib/permissions.js. */
export const PERMISSIONS = [
  'view_documents',
  'view_annotation',
  'edit_capture',
  'view_stats',
  'export_csv',
  'manage_users',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_INFO: Record<Permission, { label: string; hint: string }> = {
  view_documents: { label: 'Filter Table', hint: 'See the Filter Table list' },
  view_annotation: { label: 'Annotation', hint: 'See EAN → batch drill-down' },
  edit_capture: { label: 'Edit captures', hint: 'Change batch, MRP, MFD, expiry' },
  view_stats: { label: 'Edit Stats', hint: 'See accuracy / edit stats' },
  export_csv: { label: 'Export CSV', hint: 'Download Edit Stats CSV' },
  manage_users: { label: 'Manage users', hint: 'Users, roles and change log' },
};

/** New roles start with everything except user management (same as backend default). */
export const DEFAULT_PERMISSIONS: Permission[] = PERMISSIONS.filter((p) => p !== 'manage_users');

/** Pages in nav order → first one the user may open is their home. */
export const PAGE_PERMISSION: { path: string; perm: Permission }[] = [
  { path: '/documents', perm: 'view_documents' },
  { path: '/annotation', perm: 'view_annotation' },
  { path: '/stats', perm: 'view_stats' },
  { path: '/users', perm: 'manage_users' },
];

export const homePath = (perms: readonly Permission[]) => PAGE_PERMISSION.find((p) => perms.includes(p.perm))?.path ?? null;
