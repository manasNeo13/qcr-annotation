/**
 * Single API surface for the UI. Swaps between mock and real backend via VITE_USE_MOCK.
 *
 * Backend contract:
 *   POST  /auth/login                { email, password }               → { token, user }
 *   GET   /documents                 ?page&pageSize&q&status&from&to    → ListResponse
 *   GET   /documents/dates           ?from&to                           → DayCounts (calendar dots)
 *   GET   /documents/:id                                                → DocumentItem
 *   GET   /documents/:id/neighbors   ?q&status&from&to                  → Neighbors (prev/next)
 *   PATCH /documents/:id             { metadata }                       → DocumentItem
 *   GET   /documents/filters                                           → FilterOptions
 *   GET   /documents/groups/ean|batch  ?…list filter                    → GroupResponse
 *   GET   /documents/stats           ?from&to&client&detail=1           → EditStats
 *   GET   /documents/edited          ?changed&editor&…list filter       → ListResponse (items carry `edit`)
 *   Neighbors with `changed` → prev/next inside the edited list.
 *   List filter also takes client, ean, batch.
 */
import type {
  DayCounts,
  DayScope,
  DocMetadata,
  DocumentItem,
  EditStats,
  FilterOptions,
  GroupResponse,
  ListFilter,
  ListParams,
  ListResponse,
  LoginResponse,
  Neighbors,
  StatsFilter,
} from '../types';
import { request, USE_MOCK } from './client';
import { mockApi } from './mock';

function filterQs({ status, ...rest }: ListFilter) {
  const qs = new URLSearchParams();
  if (status && status !== 'all') qs.set('status', status);
  for (const [k, v] of Object.entries(rest)) if (v) qs.set(k, String(v));
  return qs;
}

const pagedQs = ({ page, pageSize, ...filter }: ListParams) => {
  const qs = filterQs(filter);
  qs.set('page', String(page));
  qs.set('pageSize', String(pageSize));
  return qs;
};

const real = {
  login: (email: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  listDocuments: (p: ListParams) => request<ListResponse>(`/documents?${pagedQs(p)}`),

  /** Edit-stats drill-down. p.changed required. */
  listEdited: (p: ListParams) => request<ListResponse>(`/documents/edited?${pagedQs(p)}`),

  listGroups: (by: 'ean' | 'batch', p: ListParams) => request<GroupResponse>(`/documents/groups/${by}?${pagedQs(p)}`),

  getFilterOptions: () => request<FilterOptions>('/documents/filters'),

  /** Calendar dots + latest day, narrowed by client when given. */
  getDays: (from: string, to: string, scope: DayScope = {}) => {
    const qs = new URLSearchParams({ from, to });
    for (const [k, v] of Object.entries(scope)) if (v) qs.set(k, v);
    return request<DayCounts>(`/documents/dates?${qs}`);
  },

  /** detail = include per-image rows (CSV export). */
  getStats: (f: StatsFilter, detail = false) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
    if (detail) qs.set('detail', '1');
    return request<EditStats>(`/documents/stats?${qs}`);
  },

  getNeighbors: (id: string, filter: ListFilter) =>
    request<Neighbors>(`/documents/${encodeURIComponent(id)}/neighbors?${filterQs(filter)}`),

  getDocument: (id: string) => request<DocumentItem>(`/documents/${encodeURIComponent(id)}`),

  // Backend derives editor from the JWT; extra arg kept for mock parity.
  updateDocument: (id: string, metadata: DocMetadata) =>
    request<DocumentItem>(`/documents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata }),
    }),
};

export const api = USE_MOCK ? mockApi : real;
