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
 */
import type {
  DayCounts,
  DocMetadata,
  DocumentItem,
  ListFilter,
  ListParams,
  ListResponse,
  LoginResponse,
  Neighbors,
} from '../types';
import { request, USE_MOCK } from './client';
import { mockApi } from './mock';

function filterQs({ q, status, from, to }: ListFilter) {
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (status && status !== 'all') qs.set('status', status);
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  return qs;
}

const real = {
  login: (email: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  listDocuments: ({ page, pageSize, ...filter }: ListParams) => {
    const qs = filterQs(filter);
    qs.set('page', String(page));
    qs.set('pageSize', String(pageSize));
    return request<ListResponse>(`/documents?${qs}`);
  },

  getDays: (from: string, to: string) => request<DayCounts>(`/documents/dates?${new URLSearchParams({ from, to })}`),

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
