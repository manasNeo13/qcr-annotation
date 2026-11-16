/**
 * Live captures: one shared poller per backend process → pushes "new capture" events to browsers.
 *
 *   DB  ──(every 15s, metadata by _id)──▶ poller ──▶ SSE clients (/api/live/stream)
 *                                              └──▶ buffer (15 min) ──▶ fallback polling (/api/live/events)
 *
 * - Polls only while someone is watching (open stream, or a fallback poll in the last ~70s).
 * - Re-reads the last 2 min each tick (inserts can land slightly out of _id order) + `seen` set → no dupes.
 * - Docs without image / environment yet are re-checked for up to 10 min, then dropped.
 * - DB errors → back off (15s, 30s, 60s, max 2 min). Never crashes the API.
 * - Events are filtered per user by store scope (repo.live.visibleTo).
 * - Edits (any app) on captures from the last 24h: value fingerprints compared tick to tick → "updated" { envs }.
 * - Deletions: fingerprint vanished, or total doc count dropped → "changed" to everyone → browsers reload lists.
 *   (Older captures: edits not seen; delete + insert within one tick can hide a deletion.)
 */
import { repo } from '../repos/index.js';

export const POLL_MS = 15_000;
export const HEARTBEAT_MS = 25_000;
const OVERLAP_MS = 120_000;
const WAIT_MAX_MS = 10 * 60_000;
const BUFFER_MS = 15 * 60_000;
const FALLBACK_ACTIVE_MS = 2 * POLL_MS + 10_000;
const MAX_BACKOFF = 8;
const EDIT_WINDOW_MS = 24 * 3600_000;
const EDIT_LIMIT = 5000; // newest docs fingerprinted per tick

/** @type {Set<{ user: object, send: (event: string, data: object) => void, close: () => void }>} */
const clients = new Set();
const seen = new Map(); // metadata _id → first seen (ms)
const waiting = new Map(); // metadata _id → first seen (ms); no image / env yet
/** Announced events: { id, env, ts, ean, batch, stores, at } (at = server ms when announced). */
let buffer = [];
const listeners = new Set();

let timer = null;
let primed = false;
let bookmark = 0; // newest insert time seen (ms)
let failures = 0;
let lastFallbackPoll = 0;
let lastCount = null; // metadata doc count at last tick
let changedAt = 0; // server ms of last detected deletion
let prints = null; // metadata _id → { env, hash } at last tick
/** Edited captures: { env, stores, at }. */
let updBuffer = [];

/** Called with new events (e.g. clear cached id lists). */
export const onNewCaptures = (fn) => listeners.add(fn);

const isActive = () => clients.size > 0 || Date.now() - lastFallbackPoll < FALLBACK_ACTIVE_MS;
const publicEvent = ({ id, env, ts, ean, batch, at }) => ({ id, env, ts, ean, batch, at });

function ensureRunning() {
  if (timer) return;
  // Fresh start (boot or after idle): first tick only marks what exists as seen.
  primed = false;
  lastCount = null;
  prints = null;
  bookmark = Date.now();
  failures = 0;
  timer = setTimeout(tick, 0);
}

async function collect() {
  const now = Date.now();
  const recent = await repo.live.since(Math.min(bookmark, now) - OVERLAP_MS);
  for (const [id, at] of seen) if (now - at > OVERLAP_MS + WAIT_MAX_MS) seen.delete(id);
  for (const [id, at] of waiting) if (now - at > WAIT_MAX_MS) waiting.delete(id);

  const fresh = recent.filter((d) => !seen.has(d.id));
  for (const d of recent) bookmark = Math.max(bookmark, parseInt(d.id.slice(0, 8), 16) * 1000);

  if (!primed) {
    for (const d of fresh) seen.set(d.id, now);
    primed = true;
    return [];
  }

  const retry = await repo.live.byIds([...waiting.keys()].filter((id) => !fresh.some((d) => d.id === id)));
  const candidates = [...fresh, ...retry];
  const withImage = candidates.filter((d) => d.hasImage && d.env);
  const stores = await repo.live.storesOf([...new Set(withImage.map((d) => d.env))]);

  const ready = [];
  for (const d of candidates) {
    if (!seen.has(d.id)) seen.set(d.id, now);
    const keys = stores.get(d.env);
    if (d.hasImage && d.env && (keys || repo.name === 'memory')) {
      waiting.delete(d.id);
      ready.push({ ...d, stores: keys ?? [], at: now });
    } else if (!waiting.has(d.id)) {
      waiting.set(d.id, now);
    }
  }
  return ready;
}

/** ObjectId hex lower bound for a time (ms). */
const idAt = (ms) => Math.floor(ms / 1000).toString(16).padStart(8, '0') + '0000000000000000';

/** Compare fingerprints with last tick → edited env ids + whether recent docs vanished. */
async function detectEdits() {
  const since = Date.now() - EDIT_WINDOW_MS;
  const list = await repo.live.prints(since, EDIT_LIMIT);
  const next = new Map(list.map((p) => [p.id, p]));
  const prev = prints;
  prints = next;
  if (!prev) return { edited: [], removed: false };
  // Missing ids count as deleted only inside the range we actually read (limit hit → oldest read id).
  const floor = list.length >= EDIT_LIMIT ? list[list.length - 1].id : idAt(since);
  const edited = new Set();
  let removed = false;
  for (const [id, p] of next) {
    const old = prev.get(id);
    if (old && old.hash !== p.hash && p.env) edited.add(p.env);
  }
  for (const [id, old] of prev) {
    if (!next.has(id) && id > floor) {
      removed = true;
      if (old.env) edited.add(old.env);
    }
  }
  return { edited: [...edited], removed };
}

async function tick() {
  timer = null;
  if (!isActive()) return; // nobody watching → stop; next client restarts
  try {
    const events = await collect();
    const { edited, removed } = await detectEdits();
    const count = await repo.live.count();
    const deleted = removed || (lastCount != null && count < lastCount);
    lastCount = count;
    failures = 0;
    if (edited.length) {
      const now = Date.now();
      const stores = await repo.live.storesOf(edited);
      const ups = edited.filter((env) => stores.has(env)).map((env) => ({ env, stores: stores.get(env), at: now }));
      updBuffer = [...updBuffer.filter((u) => now - u.at < BUFFER_MS), ...ups];
      for (const fn of listeners) fn([]); // status/order may change → drop cached id lists
      await Promise.all(
        [...clients].map(async (c) => {
          try {
            const mine = await repo.live.visibleTo(c.user, ups);
            if (mine.length) c.send('updated', { now, envs: mine.map((u) => u.env) });
          } catch {
            /* handled on next captures broadcast */
          }
        }),
      );
    }
    if (deleted) {
      changedAt = Date.now();
      repo.live.onAnnounced([]);
      for (const fn of listeners) fn([]);
      for (const c of clients) c.send('changed', { now: changedAt });
    }
    if (events.length) {
      const now = Date.now();
      buffer = [...buffer.filter((e) => now - e.at < BUFFER_MS), ...events];
      repo.live.onAnnounced(events); // before broadcast → browsers' reload sees the new captures
      for (const fn of listeners) fn(events);
      await broadcast(events);
    }
  } catch (e) {
    failures = Math.min(failures + 1, MAX_BACKOFF);
    console.warn(`[live] poll failed (${failures}): ${e.message}`);
  }
  timer = setTimeout(tick, POLL_MS * 2 ** Math.min(failures, 3));
}

async function broadcast(events) {
  await Promise.all(
    [...clients].map(async (c) => {
      try {
        const mine = await repo.live.visibleTo(c.user, events);
        if (mine.length) c.send('captures', { now: Date.now(), events: mine.map(publicEvent) });
      } catch (e) {
        if (e.status === 401) c.close(); // account deactivated
      }
    }),
  );
}

/** Buffered events after `since` (server ms) visible to user. */
async function eventsSince(user, since) {
  if (!since) return [];
  return (await repo.live.visibleTo(user, buffer.filter((e) => e.at > since))).map(publicEvent);
}

/** GET /api/live/stream — Server-Sent Events. ?since=<server ms> → catch up after reconnect. */
export async function stream(req, res) {
  await repo.live.visibleTo(req.user, []); // 401 if inactive, warms scope cache

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx: don't hold events
  });
  res.flushHeaders();
  req.socket.setTimeout?.(0);
  req.socket.setNoDelay?.(true);

  let open = true;
  let beat = null;
  const write = (chunk) => open && res.write(chunk);
  const client = {
    user: req.user,
    send: (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    close: () => {
      if (!open) return;
      open = false;
      clearInterval(beat);
      clients.delete(client);
      res.end();
    },
  };

  req.on('close', () => client.close());

  // 2 KB padding: some proxies hold the first bytes until a buffer fills.
  write(`:${' '.repeat(2048)}\nretry: 5000\n\n`);
  client.send('hello', { now: Date.now(), interval: POLL_MS });
  const missed = await eventsSince(req.user, Number(req.query.since) || 0);
  if (!open) return;
  if (missed.length) client.send('captures', { now: Date.now(), events: missed });

  beat = setInterval(() => client.send('ping', { now: Date.now() }), HEARTBEAT_MS);
  clients.add(client);
  ensureRunning();
}

/** GET /api/live/events?since=<server ms> — fallback when the stream can't get through. */
export async function poll(req, res) {
  lastFallbackPoll = Date.now();
  ensureRunning();
  const events = await eventsSince(req.user, Number(req.query.since) || 0);
  const since = Number(req.query.since) || 0;
  const updated = since
    ? [...new Set((await repo.live.visibleTo(req.user, updBuffer.filter((u) => u.at > since))).map((u) => u.env))]
    : [];
  res.set('Cache-Control', 'no-store').json({ now: Date.now(), interval: POLL_MS, events, updated, changed: !!since && changedAt > since });
}

/** Close streams on shutdown (else server.close() waits forever). */
export function closeAll() {
  for (const c of clients) c.close();
  if (timer) clearTimeout(timer);
  timer = null;
}
