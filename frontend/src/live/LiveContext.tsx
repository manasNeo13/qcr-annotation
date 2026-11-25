/**
 * Live captures: one checker per tab, shared by all pages.
 *
 *   Asks /live/events every 15s — only while the tab is visible. Hidden tab → no calls at all.
 *   Tab shown again → asks once right away, then every 15s.
 *   Server says `stale` (away too long, gap it can't fill) → lists reload quietly.
 *
 * Deleted captures → `changed` → lists reload quietly (no pill).
 * Edited captures (any app) → `updated` → lists reload quietly, rows glow.
 * Pages can subscribe() to signals (detail page: "this capture changed elsewhere").
 * New captures collect in `pending` (one per capture/env). Pages show a pill and decide when to refresh.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, request, USE_MOCK } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';
import { useAccess } from '../auth/useAccess';
import { refreshLists } from './refresh';

export interface LiveEvent {
  id: string; // metadata _id
  env: string; // capture id (row id)
  ts: string; // capture time ISO
  ean: string;
  batch: string;
}

export type LiveStatus = 'connecting' | 'live' | 'offline';

/** What happened: new reads (captures), edited captures, or something deleted (no ids). */
export type LiveSignal = { kind: 'captures' | 'updated'; envs: string[] } | { kind: 'changed' };

interface LiveCtx {
  status: LiveStatus;
  /** Pending new captures (oldest first), one per env. */
  pending: LiveEvent[];
  /** Remove these captures from pending (after the page refreshed). */
  dismiss: (envs: string[]) => void;
  /** Capture ids + group keys to glow briefly after refresh. */
  highlight: Set<string>;
  flash: (keys: string[]) => void;
  /** Listen to live signals; returns unsubscribe. */
  subscribe: (fn: (s: LiveSignal) => void) => () => void;
}

const Ctx = createContext<LiveCtx | null>(null);

const DEFAULT_POLL_MS = 15_000;
const MAX_PENDING = 500;
const FLASH_MS = 6_000;
interface PollResult {
  now: number;
  interval: number;
  events: LiveEvent[];
  updated: string[];
  changed: boolean;
  /** Server can't tell what happened since `since` → reload lists. */
  stale?: boolean;
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const { canAny, loading } = useAccess();
  const enabled = !USE_MOCK && !loading && canAny('view_documents', 'view_annotation');

  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [pending, setPending] = useState<LiveEvent[]>([]);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const qc = useQueryClient();
  const cursor = useRef(0); // server time of last answer → next ask gets only what's newer
  const subs = useRef(new Set<(s: LiveSignal) => void>());
  const flashRef = useRef<(keys: string[]) => void>(() => {});
  const emit = useCallback((s: LiveSignal) => subs.current.forEach((fn) => fn(s)), []);
  const subscribe = useCallback((fn: (s: LiveSignal) => void) => {
    subs.current.add(fn);
    return () => void subs.current.delete(fn);
  }, []);

  const add = useCallback((events: LiveEvent[] = []) => {
    if (!events.length) return;
    setPending((cur) => {
      const map = new Map(cur.map((e) => [e.env, e]));
      for (const e of events) if (e.env) map.set(e.env, map.get(e.env) ?? e);
      return [...map.values()].slice(-MAX_PENDING);
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let pollMs = DEFAULT_POLL_MS;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!stopped && !document.hidden) timer = setTimeout(pollOnce, ms);
    };

    async function pollOnce() {
      if (stopped || document.hidden || inFlight) return;
      inFlight = true;
      try {
        const qs = cursor.current ? `?since=${cursor.current}` : '';
        const r = await request<PollResult>(`/live/events${qs}`);
        if (stopped) return;
        cursor.current = r.now;
        if (r.interval) pollMs = r.interval;
        if (r.stale) refreshLists(qc);
        if (r.events?.length) {
          add(r.events);
          emit({ kind: 'captures', envs: r.events.map((e) => e.env) });
        }
        if (r.updated?.length) {
          // Cached (not open) captures → stale; open detail page decides itself (may have unsaved edits).
          for (const env of r.updated) qc.invalidateQueries({ queryKey: ['document', env], refetchType: 'none' });
          refreshLists(qc);
          flashRef.current(r.updated);
          emit({ kind: 'updated', envs: r.updated });
        }
        if (r.changed) {
          refreshLists(qc);
          emit({ kind: 'changed' });
        }
        setStatus('live');
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) {
          stopped = true;
          setStatus('offline');
          return;
        }
        if (!stopped) setStatus('offline');
      } finally {
        inFlight = false;
      }
      schedule(pollMs);
    }

    // Hidden → stop; shown → ask right away.
    const onVis = () => {
      if (document.hidden) clearTimeout(timer);
      else schedule(0);
    };
    document.addEventListener('visibilitychange', onVis);

    setStatus('connecting');
    schedule(0);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled, add, qc, emit]);

  const dismiss = useCallback((envs: string[]) => {
    const drop = new Set(envs);
    setPending((cur) => cur.filter((e) => !drop.has(e.env)));
  }, []);

  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = useCallback((keys: string[]) => {
    setHighlight(new Set(keys));
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setHighlight(new Set()), FLASH_MS);
  }, []);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  useEffect(() => {
    flashRef.current = flash;
  }, [flash]);

  const value = useMemo(
    () => ({ status: enabled ? status : ('offline' as const), pending, dismiss, highlight, flash, subscribe }),
    [enabled, status, pending, dismiss, highlight, flash, subscribe],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLive() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLive outside LiveProvider');
  return v;
}
