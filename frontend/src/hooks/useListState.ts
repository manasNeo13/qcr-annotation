import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '../api';
import type { DayScope, EditKey, ListFilter, StatusFilter } from '../types';
import { FILTERS } from '../utils/status';

const isStatus = (v: string | null): v is StatusFilter => FILTERS.some((f) => f.value === v);
const DEFAULTS: Record<string, string> = { page: '1', status: 'all', q: '' };

/** URL keys that describe the list view (carried into drill-down + detail page). */
export const VIEW_KEYS = ['q', 'status', 'from', 'to', 'all', 'client', 'changed', 'editor', 'day', 'grnEdited'] as const;
const EDIT_KEYS: EditKey[] = ['batch', 'mrp', 'mfd', 'expiry', 'any'];
const isEditKey = (v: string | null): v is EditKey => EDIT_KEYS.includes(v as EditKey);

/** Copy of params keeping only view keys (minus `drop`), plus `extra`. */
export function carryParams(params: URLSearchParams, drop: string[] = [], extra: Record<string, string> = {}) {
  const next = new URLSearchParams();
  for (const k of VIEW_KEYS) {
    const v = params.get(k);
    if (v != null && !drop.includes(k)) next.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) next.set(k, v);
  return next;
}

/** Edit Stats link keeping date range + client + open drill-down section (changed/editor/day/page). */
export function statsPath(params: URLSearchParams) {
  const s = carryParams(params, ['q', 'status'], params.get('page') ? { page: params.get('page')! } : {}).toString();
  return `/stats${s ? `?${s}` : ''}`;
}

/** Edit Stats drill-down day (single capture day picked in "By capture day" table). */
export const readDay = (params: URLSearchParams) => {
  const d = params.get('day');
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
};

/** Reads list filters from URL (shared by Documents + Annotation pages). */
export function readFilter(params: URLSearchParams, scoped = true): ListFilter {
  const statusParam = params.get('status');
  const allDates = params.get('all') === '1';
  const from = allDates ? undefined : (params.get('from') ?? undefined);
  const changed = params.get('changed');
  return {
    q: params.get('q') ?? '',
    status: isStatus(statusParam) ? statusParam : 'all',
    from,
    to: from ? (params.get('to') ?? from) : undefined,
    // Annotation pages ignore client (no dropdown there).
    client: scoped ? (params.get('client') ?? undefined) : undefined,
    // Edit-stats drill-down (Filter Table only). editor ignored without changed.
    ...(scoped && isEditKey(changed) ? { changed, editor: params.get('editor') || undefined } : {}),
    grnEdited: params.get('grnEdited') === '1' ? true : undefined,
  };
}

/** URL-backed list state: filters, page, debounced search, default date = latest day with data. */
export function useListState({ scoped = true }: { scoped?: boolean } = {}) {
  const [params, setParams] = useSearchParams();
  const filter = readFilter(params, scoped);
  const page = Math.max(1, Number(params.get('page')) || 1);
  const allDates = params.get('all') === '1';
  const needDefaultDate = !allDates && !filter.from;
  const [search, setSearch] = useState(filter.q ?? '');

  const update = (patch: Record<string, string | number | null | undefined>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => {
      if (v == null || v === '' || String(v) === DEFAULTS[k]) next.delete(k);
      else next.set(k, String(v));
    });
    setParams(next, { replace: true });
  };

  const setRange = (a?: string, b?: string, extra: Record<string, string | null> = {}) =>
    update({
      ...(a ? { from: a, to: b && b !== a ? b : null, all: null, page: 1 } : { from: null, to: null, all: '1', page: 1 }),
      ...extra,
    });

  const today = dayjs().format('YYYY-MM-DD');
  const scope: DayScope = { client: filter.client };
  // Latest day with data for current client (calendar "latest" + first-load default).
  const { data: latestInfo } = useQuery({
    queryKey: ['latest-day', scope],
    queryFn: () => api.getDays(today, today, scope),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const latest = latestInfo?.latest ?? null;

  useEffect(() => {
    if (needDefaultDate && latestInfo) setRange(latest ?? undefined, latest ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needDefaultDate, latestInfo]);

  // Debounced search → URL
  useEffect(() => {
    if (search === (filter.q ?? '')) return;
    const t = setTimeout(() => update({ q: search.trim(), page: 1 }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return { params, filter, scope, page, allDates, needDefaultDate, latest, search, setSearch, update, setRange };
}

export type ListState = ReturnType<typeof useListState>;
