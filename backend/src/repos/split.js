/**
 * Split team (Mongo only): NHQ picks members; NEW captures are divided equally among them, per IST day.
 *
 *   users:    split_team: true, split_joined_at: Date
 *   metadata: assigned_to (user id), assigned_day ('YYYY-MM-DD' IST of capture), assigned_at, assigned_by ('auto' | NHQ id)
 *
 * - "New" = capture (env_id) whose FIRST metadata doc was inserted after the team started
 *   (start = earliest split_joined_at). Older captures are never assigned → every member sees them.
 * - Assigner runs always (not only while browsers poll): every 15s + right before live announces.
 *   Recapture of an assigned capture → same owner. New capture → member with fewest captures that day.
 * - Writes are conditional (assigned_to missing) → never overwrites, safe with several backend copies.
 * - Members see: unassigned (old) captures of every client + captures assigned to them (repos/mongo.js scope()).
 */
import { ObjectId } from 'mongodb';
import { HttpError } from '../lib/httpError.js';
import { istDay, istWindow } from '../lib/istDay.js';
import { isSuperAdmin, roleKey } from '../lib/permissions.js';
import { clearAccessCache, getDb } from './mongo.js';

const TICK_MS = 15_000;
const OVERLAP_MS = 120_000;
const BATCH = 5000;

const col = (n) => getDb().collection(n);

let team = null; // { members: [{ id, active, joinedAt }], startId: ObjectId | null }
let counts = new Map(); // day → Map<userId, captures>
let bookmark = 0; // newest insert time handled (ms)
let timer = null;
let running = null; // in-flight assign() promise (serialised)
const skipped = new Set(); // env ids of OLD captures seen with new docs (recaptures) → not assigned
let failures = 0;

// ── Team ─────────────────────────────────────────────────────────────────
async function loadTeam() {
  const docs = await col('users')
    .find({ split_team: true }, { projection: { _id: 0, id: 1, status: 1, role: 1, split_joined_at: 1 } })
    .toArray();
  const members = docs
    .filter((u) => u.id && !isSuperAdmin(roleKey(u.role)))
    .map((u) => ({ id: String(u.id), active: u.status !== false, joinedAt: u.split_joined_at ? new Date(u.split_joined_at) : new Date() }));
  const start = members.length ? Math.min(...members.map((m) => m.joinedAt.getTime())) : null;
  team = { members, startId: start ? ObjectId.createFromTime(Math.floor(start / 1000)) : null };
  return team;
}
const getTeam = async () => team ?? loadTeam();

/** Is this user on the split team? (scope() calls this per user, cached with the team.) */
export async function isMember(userId) {
  return (await getTeam()).members.some((m) => m.id === userId);
}

/** Captures (env ids) per member for one IST day. */
async function countDay(day) {
  const rows = await col('metadata')
    .aggregate([
      { $match: { assigned_day: day, assigned_to: { $exists: true } } },
      { $group: { _id: { a: '$assigned_to', e: '$env_id' } } },
      { $group: { _id: '$_id.a', n: { $sum: 1 } } },
    ])
    .toArray();
  return new Map(rows.map((r) => [String(r._id), r.n]));
}
async function dayCounts(day) {
  if (!counts.has(day)) counts.set(day, await countDay(day));
  return counts.get(day);
}

// ── Assigner ─────────────────────────────────────────────────────────────
const timeOf = (d) => {
  const t = d.started_at ?? d.timestamp;
  const date = t ? new Date(t) : null;
  return date && !Number.isNaN(date.getTime()) ? date : d._id.getTimestamp();
};

async function pick(day, members) {
  const c = await dayCounts(day);
  let best = null;
  for (const m of members) if (!best || (c.get(m.id) ?? 0) < (c.get(best.id) ?? 0)) best = m;
  return best;
}

/** One pass: unassigned docs inserted since `fromMs` (or since team start). Returns envs assigned. */
async function assignPass(fromMs) {
  const { members, startId } = await getTeam();
  const active = members.filter((m) => m.active);
  if (!startId || !active.length) return 0;
  const from = fromMs ? ObjectId.createFromTime(Math.floor(fromMs / 1000)) : startId;
  const lower = from.getTimestamp() > startId.getTimestamp() ? from : startId;
  const docs = await col('metadata')
    .find(
      { _id: { $gte: lower }, assigned_to: { $exists: false }, env_id: { $type: 'string' } },
      { projection: { env_id: 1, started_at: 1, timestamp: 1 } },
    )
    .sort({ _id: 1 })
    .limit(BATCH)
    .toArray();
  for (const d of docs) bookmark = Math.max(bookmark, d._id.getTimestamp().getTime());
  // First doc per env (insert order) → capture time / day.
  const envs = new Map();
  for (const d of docs) if (!skipped.has(d.env_id) && !envs.has(d.env_id)) envs.set(d.env_id, d);
  if (!envs.size) return 0;
  const ids = [...envs.keys()];
  const [owned, old] = await Promise.all([
    col('metadata')
      .find({ env_id: { $in: ids }, assigned_to: { $exists: true } }, { projection: { _id: 0, env_id: 1, assigned_to: 1, assigned_day: 1 } })
      .toArray(),
    col('metadata').find({ env_id: { $in: ids }, _id: { $lt: startId } }, { projection: { _id: 0, env_id: 1 } }).toArray(),
  ]);
  const ownerOf = new Map(owned.map((o) => [o.env_id, o]));
  const oldSet = new Set(old.map((o) => o.env_id));
  const now = new Date();
  let n = 0;
  for (const [env, d] of envs) {
    const prev = ownerOf.get(env); // owner first: old captures NHQ divided (divideDays) keep their owner
    if (!prev && oldSet.has(env)) {
      skipped.add(env); // capture began before the team → stays shared
      continue;
    }
    let to;
    let day;
    let fresh = false;
    if (prev) {
      to = String(prev.assigned_to); // recapture → same owner
      day = prev.assigned_day ?? istDay(timeOf(d));
    } else {
      day = istDay(timeOf(d));
      to = (await pick(day, active))?.id;
      fresh = true;
    }
    if (!to) continue;
    const res = await col('metadata').updateMany(
      { env_id: env, assigned_to: { $exists: false } },
      { $set: { assigned_to: to, assigned_day: day, assigned_at: now, assigned_by: 'auto' } },
    );
    if (fresh && res.modifiedCount) {
      const c = await dayCounts(day);
      c.set(to, (c.get(to) ?? 0) + 1);
    }
    n += 1;
  }
  if (skipped.size > 50_000) skipped.clear();
  if (n) clearAccessCache();
  return n;
}

/** Assign everything pending now (serialised). Live poller awaits this before announcing. */
export function assignNow() {
  running ??= (async () => {
    try {
      if (!team) await loadTeam();
      if (!team.startId) return 0;
      // First run (boot / team change): full sweep from team start; then only recent docs.
      const full = !bookmark;
      let total = 0;
      for (let i = 0; i < 20; i++) {
        const n = await assignPass(full ? 0 : bookmark - OVERLAP_MS);
        total += n;
        if (!full || n === 0) break;
      }
      if (full && !bookmark) bookmark = Date.now();
      failures = 0;
      return total;
    } finally {
      running = null;
    }
  })();
  return running;
}

async function tick() {
  timer = null;
  try {
    await assignNow();
  } catch (e) {
    failures = Math.min(failures + 1, 4);
    console.warn(`[split] assign failed (${failures}): ${e.message}`);
  }
  timer = setTimeout(tick, TICK_MS * 2 ** Math.min(failures, 3));
}

/** Boot: index + start the always-on assigner. */
export async function startAssigner() {
  try {
    await col('metadata').createIndex({ assigned_to: 1 });
  } catch (e) {
    console.warn(`[split] index: ${e.message}`);
  }
  if (!timer) timer = setTimeout(tick, 0);
}
export function stopAssigner() {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Team / assignments changed → reload team, recount, full sweep next tick. */
function reset() {
  team = null;
  counts = new Map();
  bookmark = 0;
  skipped.clear();
  clearAccessCache();
}

// ── Admin (NHQ) ──────────────────────────────────────────────────────────
/** Change log row (same shape as repos/admin.js: changes = { field: { from, to } }). */
async function audit(by, action, changes) {
  const target = { type: 'split', id: '', name: 'Split team' };
  await col('annotation_audit').insertOne({ at: new Date(), by: { id: by.id, name: by.name }, action, target, changes });
}

async function totals() {
  const rows = await col('metadata')
    .aggregate([
      { $match: { assigned_to: { $exists: true } } },
      { $group: { _id: { a: '$assigned_to', e: '$env_id' } } },
      { $group: { _id: '$_id.a', n: { $sum: 1 } } },
    ])
    .toArray();
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

/** Team + today / total counts + users that can be added. */
export async function overview() {
  await loadTeam();
  const today = istDay(new Date());
  const [t, c, users] = await Promise.all([
    totals(),
    countDay(today),
    col('users')
      .find({ id: { $exists: true } }, { projection: { _id: 0, id: 1, name: 1, email: 1, role: 1, status: 1, split_team: 1, split_joined_at: 1 } })
      .toArray(),
  ]);
  const name = (u) => String(u.name || u.email || u.id);
  const members = users
    .filter((u) => u.split_team === true && !isSuperAdmin(roleKey(u.role)))
    .map((u) => ({
      id: String(u.id),
      name: name(u),
      email: u.email ? String(u.email) : '',
      active: u.status !== false,
      joinedAt: u.split_joined_at ? new Date(u.split_joined_at).toISOString() : null,
      today: c.get(String(u.id)) ?? 0,
      total: t.get(String(u.id)) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const candidates = users
    .filter((u) => u.split_team !== true && u.status !== false && !isSuperAdmin(roleKey(u.role)))
    .map((u) => ({ id: String(u.id), name: name(u), email: u.email ? String(u.email) : '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { startedAt: team.startId ? team.startId.getTimestamp().toISOString() : null, today, members, candidates };
}

async function addMembers(ids, by) {
  if (!ids.length) return [];
  const docs = await col('users').find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, role: 1, status: 1, name: 1 } }).toArray();
  if (docs.length !== ids.length) throw new HttpError(400, 'Unknown user');
  const bad = docs.find((u) => isSuperAdmin(roleKey(u.role)) || u.status === false);
  if (bad) throw new HttpError(400, `${bad.name || bad.id} can't join the split team (NHQ or inactive)`);
  await col('users').updateMany({ id: { $in: ids }, split_team: { $ne: true } }, { $set: { split_team: true, split_joined_at: new Date() } });
  await audit(by, 'split.add', { members: { from: null, to: docs.map((u) => u.name || u.id) } });
  return ids;
}

/** Set team = `ids`. Removing a member only when they hold no captures (move them first). */
export async function setTeam(ids, by) {
  const wanted = [...new Set(ids.map(String))];
  const cur = (await loadTeam()).members.map((m) => m.id);
  const add = wanted.filter((id) => !cur.includes(id));
  const remove = cur.filter((id) => !wanted.includes(id));
  if (remove.length) {
    const t = await totals();
    const busy = remove.filter((id) => (t.get(id) ?? 0) > 0);
    if (busy.length) throw new HttpError(409, `Move their captures first: ${busy.join(', ')}`);
  }
  await addMembers(add, by);
  if (remove.length) {
    await col('users').updateMany({ id: { $in: remove } }, { $unset: { split_team: '', split_joined_at: '' } });
    await audit(by, 'split.remove', { members: { from: remove, to: null } });
  }
  reset();
  assignNow().catch(() => {});
  return overview();
}

/**
 * Divide captures of past IST days (fromDay..toDay) that nobody owns yet, equally per day among active members.
 * dry = preview only. Capture day = newest capture time of the capture (same day the lists show).
 * Already-assigned captures are untouched and count towards the per-day balance.
 */
export async function divideDays({ fromDay, toDay, dry }, by) {
  const { members } = await loadTeam();
  const active = members.filter((m) => m.active);
  if (!active.length) throw new HttpError(400, 'Add people to the team first');
  const { start } = istWindow(fromDay, fromDay);
  const { end } = istWindow(toDay, toDay);
  const docs = await col('metadata')
    .find(
      { env_id: { $type: 'string' }, $or: [{ timestamp: { $gte: start, $lte: end } }, { started_at: { $gte: start, $lte: end } }] },
      { projection: { env_id: 1, started_at: 1, timestamp: 1, assigned_to: 1 } },
    )
    .toArray();
  // env → newest capture time; skip envs that already have an owner.
  const owned = new Set(docs.filter((d) => d.assigned_to != null).map((d) => d.env_id));
  const latest = new Map();
  for (const d of docs) {
    if (owned.has(d.env_id)) continue;
    const t = timeOf(d);
    if (!latest.has(d.env_id) || t > latest.get(d.env_id)) latest.set(d.env_id, t);
  }
  if (owned.size) {
    // Owner may sit on a doc outside the window (recapture another day).
    const more = await col('metadata').distinct('env_id', { env_id: { $in: [...latest.keys()] }, assigned_to: { $exists: true } });
    for (const e of more) latest.delete(e);
  }
  const byDay = new Map();
  for (const [env, t] of [...latest].sort((a, b) => a[1] - b[1])) {
    const day = istDay(t);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(env);
  }
  // Plan per day: each capture → member with fewest that day (existing counts included).
  const plan = new Map(); // userId → envs
  const perMember = new Map();
  for (const [day, envs] of byDay) {
    const c = new Map(await countDay(day));
    for (const env of envs) {
      let best = null;
      for (const m of active) if (!best || (c.get(m.id) ?? 0) < (c.get(best.id) ?? 0)) best = m;
      c.set(best.id, (c.get(best.id) ?? 0) + 1);
      if (!plan.has(day)) plan.set(day, []);
      plan.get(day).push([env, best.id]);
      perMember.set(best.id, (perMember.get(best.id) ?? 0) + 1);
    }
  }
  const summary = {
    captures: latest.size,
    days: [...byDay].map(([day, envs]) => ({ day, captures: envs.length })),
    perMember: active.map((m) => ({ id: m.id, captures: perMember.get(m.id) ?? 0 })),
  };
  if (dry || !latest.size) return { ...summary, done: false };
  const now = new Date();
  const ops = [];
  for (const [day, list] of plan)
    for (const [env, to] of list)
      ops.push({
        updateMany: {
          filter: { env_id: env, assigned_to: { $exists: false } },
          update: { $set: { assigned_to: to, assigned_day: day, assigned_at: now, assigned_by: by.id } },
        },
      });
  for (let i = 0; i < ops.length; i += 500) await col('metadata').bulkWrite(ops.slice(i, i + 500), { ordered: false });
  await audit(by, 'split.divide', {
    days: { from: null, to: fromDay === toDay ? fromDay : `${fromDay} – ${toDay}` },
    captures: { from: null, to: latest.size },
  });
  reset();
  return { ...summary, done: true };
}

/** Move `from`'s captures (assigned days fromDay..toDay) to `to` (joins team if needed). */
export async function move({ from, to, fromDay, toDay }, by) {
  if (from === to) throw new HttpError(400, 'Pick a different person');
  const { members } = await loadTeam();
  if (!members.some((m) => m.id === to)) await addMembers([to], by);
  const filter = { assigned_to: from, assigned_day: { $gte: fromDay, $lte: toDay } };
  const envs = await col('metadata').distinct('env_id', filter);
  const res = await col('metadata').updateMany(filter, { $set: { assigned_to: to, assigned_at: new Date(), assigned_by: by.id } });
  await audit(by, 'split.move', {
    owner: { from, to },
    days: { from: null, to: fromDay === toDay ? fromDay : `${fromDay} – ${toDay}` },
    captures: { from: null, to: envs.length },
  });
  reset();
  return { moved: envs.length, ...(await overview()) };
}
