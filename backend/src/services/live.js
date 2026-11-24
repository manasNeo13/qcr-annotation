/**
 * Live captures: one shared poller per backend process; browsers ask /api/live/events every 15s.
 *
 *   DB  ──(every 15s, metadata by _id)──▶ poller ──▶ buffer (15 min) ──▶ /api/live/events?since=
 *
 * - Polls only while someone is watching (a browser asked in the last ~40s).
 * - Browser away longer than the buffer / poller restarted since → `stale: true` → browser reloads lists.
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
const OVERLAP_MS = 120_000;
const WAIT_MAX_MS = 10 * 60_000;
const BUFFER_MS = 15 * 60_000;
const ACTIVE_MS = 2 * POLL_MS + 10_000;
const MAX_BACKOFF = 8;
const EDIT_WINDOW_MS = 24 * 3600_000;
const EDIT_LIMIT = 5000; // newest docs fingerprinted per tick

const seen = new Map(); // metadata _id → first seen (ms)
const waiting = new Map(); // metadata _id → first seen (ms); no image / env yet
/** Announced events: { id, env, ts, ean, batch, stores, at } (at = server ms when announced). */
let buffer = [];
const listeners = new Set();

let timer = null;
let primed = false;
let bookmark = 0; // newest insert time seen (ms)
let failures = 0;
let lastPoll = 0;
let runStart = 0; // server ms the current poller run started (events before it unknown)
let lastCount = null; // metadata doc count at last tick
let changedAt = 0; // server ms of last detected deletion
let prints = null; // metadata _id → { env, hash } at last tick
/** Edited captures: { env, stores, at }. */
let updBuffer = [];

/** Called with new events (e.g. clear cached id lists). */
export const onNewCaptures = (fn) => listeners.add(fn);

const isActive = () => Date.now() - lastPoll < ACTIVE_MS;
const publicEvent = ({ id, env, ts, ean, batch, at }) => ({ id, env, ts, ean, batch, at });

function ensureRunning() {
  if (timer) return;
  // Fresh start (boot or after idle): first tick only marks what exists as seen.
  primed = false;
  lastCount = null;
  prints = null;
  bookmark = Date.now();
  runStart = bookmark;
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
  if (!isActive()) return; // nobody watching → stop; next poll restarts
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
    }
    if (deleted) {
      changedAt = Date.now();
      repo.live.onAnnounced([]);
      for (const fn of listeners) fn([]);
    }
    if (events.length) {
      const now = Date.now();
      buffer = [...buffer.filter((e) => now - e.at < BUFFER_MS), ...events];
      repo.live.onAnnounced(events); // before browsers ask → their reload sees the new captures
      for (const fn of listeners) fn(events);
    }
  } catch (e) {
    failures = Math.min(failures + 1, MAX_BACKOFF);
    console.warn(`[live] poll failed (${failures}): ${e.message}`);
  }
  timer = setTimeout(tick, POLL_MS * 2 ** Math.min(failures, 3));
}

/**
 * GET /api/live/events?since=<server ms of last answer>
 * → new captures + edited captures since then; `stale` = gap we can't fill (browser reloads lists).
 */
export async function poll(req, res) {
  lastPoll = Date.now();
  ensureRunning();
  const since = Number(req.query.since) || 0;
  const stale = !!since && (since < runStart || Date.now() - since > BUFFER_MS);
  const visible = async (list) => (since && !stale ? await repo.live.visibleTo(req.user, list) : []);
  const events = (await visible(buffer.filter((e) => e.at > since))).map(publicEvent);
  const updated = [...new Set((await visible(updBuffer.filter((u) => u.at > since))).map((u) => u.env))];
  if (!since) await repo.live.visibleTo(req.user, []); // 401 if inactive, warms scope cache
  res.set('Cache-Control', 'no-store').json({
    now: Date.now(),
    interval: POLL_MS,
    events,
    updated,
    changed: !!since && changedAt > since,
    stale,
  });
}

/** Stop the poller on shutdown. */
export function closeAll() {
  if (timer) clearTimeout(timer);
  timer = null;
}
