/**
 * Live captures: one connection per tab, shared by all pages.
 *
 *   1. Stream (SSE over fetch, so the Bearer token goes in a header).
 *      Server sends hello + ping every 25s → no message for 60s = stream stuck (e.g. buffering proxy).
 *   2. Stream fails 3× in a row → fallback: ask /live/events every 15s (paused while tab hidden).
 *      Retries the stream every 5 min.
 *
 * Deleted captures → server sends "changed" → lists reload quietly (no pill).
 * Edited captures (any app) → "updated" { envs } → lists reload quietly, rows glow.
 * Pages can subscribe() to signals (detail page: "this capture changed elsewhere").
 * Hidden tab + new captures → title "(N) …" until the tab is shown again.
 * New captures collect in `pending` (one per capture/env). Pages show a pill and decide when to refresh.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { API_URL, getToken, request, UNAUTHORIZED_EVENT, USE_MOCK } from '../api/client';
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

export type LiveStatus = 'connecting' | 'live' | 'polling' | 'offline';

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

const STUCK_MS = 60_000; // 2 missed heartbeats
const HELLO_MS = 15_000;
const FAILS_BEFORE_POLL = 3;
const STREAM_RETRY_MS = 5 * 60_000;
const DEFAULT_POLL_MS = 15_000;
const MAX_PENDING = 500;
const FLASH_MS = 6_000;
const backoff = [2_000, 5_000, 10_000, 30_000];

type Msg = {
  event: string;
  data: { now?: number; interval?: number; events?: LiveEvent[]; envs?: string[]; updated?: string[]; changed?: boolean };
};

/** Parse one SSE block ("event: x\ndata: {...}"). Comments/padding → null. */
function parseBlock(block: string): Msg | null {
  let event = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return null;
  }
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const { canAny, loading } = useAccess();
  const enabled = !USE_MOCK && !loading && canAny('view_documents', 'view_annotation');

  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [pending, setPending] = useState<LiveEvent[]>([]);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const qc = useQueryClient();
  const cursor = useRef(0); // server time of last message → catch-up after reconnect
  const subs = useRef(new Set<(s: LiveSignal) => void>());
  const flashRef = useRef<(keys: string[]) => void>(() => {});
  const emit = useCallback((s: LiveSignal) => subs.current.forEach((fn) => fn(s)), []);
  const subscribe = useCallback((fn: (s: LiveSignal) => void) => {
    subs.current.add(fn);
    return () => void subs.current.delete(fn);
  }, []);

  // Tab title count while hidden.
  const [hiddenNew, setHiddenNew] = useState(0);
  const hiddenEnvs = useRef(new Set<string>());
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\) /, '');
    document.title = hiddenNew ? `(${hiddenNew > 99 ? '99+' : hiddenNew}) ${base}` : base;
  }, [hiddenNew]);
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) return;
      hiddenEnvs.current.clear();
      setHiddenNew(0);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const add = useCallback((events: LiveEvent[] = []) => {
    if (!events.length) return;
    if (document.hidden) {
      for (const e of events) if (e.env) hiddenEnvs.current.add(e.env);
      setHiddenNew(hiddenEnvs.current.size);
    }
    setPending((cur) => {
      const map = new Map(cur.map((e) => [e.env, e]));
      for (const e of events) if (e.env) map.set(e.env, map.get(e.env) ?? e);
      return [...map.values()].slice(-MAX_PENDING);
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let fails = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ctrl: AbortController | null = null;
    let pollMs = DEFAULT_POLL_MS;
    let mode: 'stream' | 'poll' = 'stream';
    let pollingSince = 0;

    const later = (fn: () => void, ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };

    const onMsg = (m: Msg) => {
      if (m.data.now) cursor.current = m.data.now;
      if (m.data.interval) pollMs = m.data.interval;
      if (m.event === 'captures' && m.data.events?.length) {
        add(m.data.events);
        emit({ kind: 'captures', envs: m.data.events.map((e) => e.env) });
      }
      const edited = m.event === 'updated' ? (m.data.envs ?? []) : (m.data.updated ?? []);
      if (edited.length) {
        // Cached (not open) captures → stale; open detail page decides itself (may have unsaved edits).
        for (const env of edited) qc.invalidateQueries({ queryKey: ['document', env], refetchType: 'none' });
        refreshLists(qc);
        flashRef.current(edited);
        emit({ kind: 'updated', envs: edited });
      }
      if (m.event === 'changed' || m.data.changed) {
        refreshLists(qc);
        emit({ kind: 'changed' });
      }
    };

    async function openStream() {
      if (stopped) return;
      mode = 'stream';
      const token = getToken();
      if (!token) return;
      ctrl = new AbortController();
      const myCtrl = ctrl;
      let lastMsg = Date.now();
      let gotHello = false;
      const watchdog = setInterval(() => {
        const limit = gotHello ? STUCK_MS : HELLO_MS;
        if (Date.now() - lastMsg > limit) myCtrl.abort();
      }, 5_000);

      try {
        const qs = cursor.current ? `?since=${cursor.current}` : '';
        const res = await fetch(`${API_URL}/live/stream${qs}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: myCtrl.signal,
          cache: 'no-store',
        });
        if (res.status === 401) {
          window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
          stopped = true;
          return;
        }
        if (res.status === 403) {
          stopped = true;
          setStatus('offline');
          return;
        }
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value.replace(/\r\n/g, '\n');
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const m = parseBlock(buf.slice(0, i));
            buf = buf.slice(i + 2);
            if (!m) continue;
            lastMsg = Date.now();
            if (m.event === 'hello') {
              gotHello = true;
              fails = 0;
              setStatus('live');
            }
            onMsg(m);
          }
        }
        throw new Error('stream closed');
      } catch {
        if (stopped) return;
        fails++;
        if (fails >= FAILS_BEFORE_POLL) {
          startPolling();
        } else {
          setStatus('connecting');
          later(openStream, backoff[Math.min(fails - 1, backoff.length - 1)]);
        }
      } finally {
        clearInterval(watchdog);
      }
    }

    async function pollOnce() {
      if (stopped || mode !== 'poll') return;
      if (document.hidden) return; // resumes on visibilitychange
      try {
        const qs = cursor.current ? `?since=${cursor.current}` : '';
        const r = await request<{ now: number; interval: number; events: LiveEvent[]; updated: string[]; changed: boolean }>(
          `/live/events${qs}`,
        );
        onMsg({ event: 'captures', data: r });
        setStatus('polling');
      } catch {
        setStatus('offline');
      }
      if (stopped || mode !== 'poll') return;
      // Every 5 min try the stream again (network/proxy may have changed).
      if (Date.now() - pollingSince > STREAM_RETRY_MS) {
        fails = FAILS_BEFORE_POLL - 1; // one more stream failure → back to polling
        later(openStream, 0);
      } else {
        later(pollOnce, pollMs);
      }
    }

    function startPolling() {
      mode = 'poll';
      pollingSince = Date.now();
      later(pollOnce, 0);
    }

    const onVisible = () => {
      if (!document.hidden && mode === 'poll') later(pollOnce, 0);
    };
    document.addEventListener('visibilitychange', onVisible);

    setStatus('connecting');
    openStream();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener('visibilitychange', onVisible);
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
