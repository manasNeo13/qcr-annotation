import type { QueryClient } from '@tanstack/react-query';

/** Lists + calendar data that new captures change (not the open capture, stats or user data). */
const LIST_KEYS = new Set(['documents', 'groups', 'latest-day', 'days', 'neighbors']);

export const refreshLists = (qc: QueryClient) =>
  qc.invalidateQueries({ predicate: (q) => LIST_KEYS.has(String(q.queryKey[0])) });
