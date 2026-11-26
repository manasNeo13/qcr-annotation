/**
 * User management API (manage_users only; real backend only — mock mode has no users).
 *   GET    /admin/users   ?q&role&status&page      → Paged<AdminUser>
 *   POST   /admin/users   AdminUserInput + id      → AdminUser
 *   PATCH  /admin/users/:key  AdminUserInput        → AdminUser
 *   POST   /admin/users/:key/password { password } → AdminUser (temporary password)
 *   GET    /admin/stores                            → StoreOption[]
 *   GET    /admin/clients                           → string[]
 *   GET    /admin/roles                             → { permissions, roles }
 *   POST   /admin/roles   { name, permissions }     → RoleInfo
 *   PUT    /admin/roles/:key { permissions }        → RoleInfo   (key '' = "~none")
 *   DELETE /admin/roles/:key                        → { moved } (users → No role)
 *   GET    /admin/audit   ?page                     → Paged<AuditEntry>
 *   GET    /admin/split                             → SplitOverview
 *   PUT    /admin/split/team { members }            → SplitOverview
 *   POST   /admin/split/divide { fromDay,toDay,dry } → SplitDivideResult (dry = preview)
 *   POST   /admin/split/move { from,to,fromDay,toDay } → SplitOverview + { moved }
 */
import type { AdminUser, AdminUserInput, AuditEntry, Paged, RoleInfo, SplitDivideResult, SplitOverview, StoreOption } from '../types';
import type { Permission } from '../utils/permissions';
import { request } from './client';

export interface UserQuery {
  q?: string;
  role?: string; // role key; '' = No role; undefined = all
  client?: string; // '' = no client assigned; undefined = all
  status?: 'all' | 'active' | 'inactive';
  page: number;
  pageSize: number;
}

const roleSeg = (key: string) => (key === '' ? '~none' : encodeURIComponent(key));
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const adminApi = {
  listUsers: (q: UserQuery) => {
    const qs = new URLSearchParams({ page: String(q.page), pageSize: String(q.pageSize) });
    if (q.q) qs.set('q', q.q);
    if (q.role !== undefined) qs.set('role', q.role);
    if (q.client !== undefined) qs.set('client', q.client);
    if (q.status && q.status !== 'all') qs.set('status', q.status);
    return request<Paged<AdminUser>>(`/admin/users?${qs}`);
  },
  /** Suggested free User ID (e.g. NE00090). */
  nextUserId: () => request<{ id: string }>('/admin/users/next-id'),
  createUser: (data: AdminUserInput & { id: string; password: string }) => request<AdminUser>('/admin/users', json('POST', data)),
  updateUser: (key: string, data: AdminUserInput) =>
    request<AdminUser>(`/admin/users/${encodeURIComponent(key)}`, json('PATCH', data)),
  deleteUser: (key: string) => request<{ deleted: string }>(`/admin/users/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  setTemporaryPassword: (key: string, password: string) =>
    request<AdminUser>(`/admin/users/${encodeURIComponent(key)}/password`, json('POST', { password })),
  stores: () => request<StoreOption[]>('/admin/stores'),
  clients: () => request<string[]>('/admin/clients'),
  roles: () => request<{ permissions: Permission[]; roles: RoleInfo[] }>('/admin/roles'),
  createRole: (name: string, permissions: Permission[]) => request<RoleInfo>('/admin/roles', json('POST', { name, permissions })),
  updateRole: (key: string, permissions: Permission[]) =>
    request<RoleInfo>(`/admin/roles/${roleSeg(key)}`, json('PUT', { permissions })),
  deleteRole: (key: string) => request<{ moved: number }>(`/admin/roles/${roleSeg(key)}`, { method: 'DELETE' }),
  split: () => request<SplitOverview>('/admin/split'),
  setSplitTeam: (members: string[]) => request<SplitOverview>('/admin/split/team', json('PUT', { members })),
  moveSplit: (body: { from: string; to: string; fromDay: string; toDay: string }) =>
    request<SplitOverview & { moved: number }>('/admin/split/move', json('POST', body)),
  divideSplit: (body: { fromDay: string; toDay: string; dry: boolean }) =>
    request<SplitDivideResult>('/admin/split/divide', json('POST', body)),
  audit: (page: number, pageSize: number) => request<Paged<AuditEntry>>(`/admin/audit?page=${page}&pageSize=${pageSize}`),
};
