/**
 * User management (Mongo only, NHQ only). `users` is SHARED with the main QCR app → edits apply there too (user decision).
 * Access in this app = assigned clients (users.clients). Temporary password → must_change_password until user sets own.
 * Role permissions live in `annotation_roles` (this app only); every change logged to `annotation_audit`.
 *
 * Roles are grouped case-insensitively (roleKey): "store_manager" + "Store_manager" = one role.
 * Blank / "1" = No role. Deleting a role sets its users' role to '' (No role).
 */
import { ObjectId } from 'mongodb';
import { HttpError } from '../lib/httpError.js';
import { hashPassword } from '../lib/password.js';
import {
  DEFAULT_PERMISSIONS,
  NO_ROLE_LABEL,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  clientsOf,
  isLockedRole,
  isSuperAdmin,
  roleKey,
} from '../lib/permissions.js';
import { clearAccessCache, getDb } from './mongo.js';

const col = (n) => getDb().collection(n);
const users = () => col('users');
const roles = () => col('annotation_roles');
const audit = () => col('annotation_audit');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Permission lookup (per request) ──────────────────────────────────────
const TTL_MS = 30_000;
let rolesCache = null; // { at, byKey: Map<key, doc> }
const userCache = new Map(); // userId → { at, role, active, clients }

async function roleDocs() {
  if (rolesCache && Date.now() - rolesCache.at < TTL_MS) return rolesCache.byKey;
  const docs = await roles().find({}).toArray();
  rolesCache = { at: Date.now(), byKey: new Map(docs.map((d) => [d.key, d])) };
  return rolesCache.byKey;
}

/** NHQ: everything. Other admin roles: everything except manage_users. Rest: role doc or default. */
const permsOf = (key, doc) =>
  isSuperAdmin(key)
    ? [...PERMISSIONS]
    : isLockedRole(key)
      ? [...ROLE_PERMISSIONS]
      : doc
        ? ROLE_PERMISSIONS.filter((p) => doc.permissions?.includes(p))
        : [...DEFAULT_PERMISSIONS];

function clearCaches(userId) {
  rolesCache = null;
  if (userId) userCache.delete(userId);
  else userCache.clear();
}

/** Current role + permissions + clients from DB (may change after login). Cached 30s. */
export async function permissionsFor(userId) {
  let u = userCache.get(userId);
  if (!u || Date.now() - u.at > TTL_MS) {
    const doc = await users().findOne({ id: userId }, { projection: { role: 1, status: 1, clients: 1 } });
    u = { at: Date.now(), role: doc?.role ?? '', active: !!doc && doc.status !== false, clients: clientsOf(doc) };
    userCache.set(userId, u);
  }
  if (!u.active) throw new HttpError(401, 'Account not active');
  const key = roleKey(u.role);
  const doc = (await roleDocs()).get(key);
  return {
    role: key ? String(u.role).trim() : NO_ROLE_LABEL,
    roleKey: key,
    permissions: permsOf(key, doc),
    superAdmin: isSuperAdmin(key),
    clients: u.clients,
  };
}

// ── Audit ────────────────────────────────────────────────────────────────
async function log(by, action, target, changes = {}) {
  await audit().insertOne({ at: new Date(), by: { id: by.id, name: by.name }, action, target, changes });
}

/** {field: {from, to}} for fields that differ. */
function diff(before, after) {
  const out = {};
  for (const k of Object.keys(after)) {
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out[k] = { from: a ?? null, to: b ?? null };
  }
  return out;
}

export async function listAudit({ page, pageSize }) {
  const [total, items] = await Promise.all([
    audit().countDocuments(),
    audit().find({}).sort({ at: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
  ]);
  return {
    total,
    items: items.map((d) => ({
      id: String(d._id),
      at: d.at?.toISOString?.() ?? null,
      by: d.by,
      action: d.action,
      target: d.target,
      changes: d.changes ?? {},
    })),
  };
}

// ── Stores (for user assignment) ─────────────────────────────────────────
export async function storeOptions() {
  const [st, wh] = await Promise.all([
    col('store').find({}, { projection: { _id: 0, id: 1, name: 1, city: 1 } }).toArray(),
    col('warehouse').find({}, { projection: { _id: 0, id: 1, name: 1, city: 1 } }).toArray(),
  ]);
  const map = (kind) => (s) => ({ id: String(s.id), name: String(s.name ?? s.id), city: String(s.city ?? '').trim(), kind });
  return [...st.filter((s) => s.id).map(map('store')), ...wh.filter((s) => s.id).map(map('warehouse'))].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  );
}

// ── Clients (for user assignment) ────────────────────────────────────────
/** Client names from captures (environment.client_name), as stored. Cached 5 min. */
let clientsCache = null;
export async function clientOptions() {
  if (clientsCache && Date.now() - clientsCache.at < 5 * 60_000) return clientsCache.list;
  const raw = await col('environment').distinct('client_name');
  const list = [...new Set(raw.filter((c) => typeof c === 'string').map((c) => c.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  clientsCache = { at: Date.now(), list };
  return list;
}

/** Keep only known clients (case-insensitive), stored in the captures' spelling. `keep` = already assigned (allowed even if no captures left). */
async function cleanClients(input, keep = []) {
  const known = new Map([...keep, ...(await clientOptions())].map((c) => [c.toLowerCase(), c]));
  const out = [];
  for (const c of input) {
    const hit = known.get(String(c).trim().toLowerCase());
    if (!hit) throw new HttpError(400, `Unknown client "${c}"`, { clients: `Unknown client "${c}"` });
    if (!out.includes(hit)) out.push(hit);
  }
  return out;
}

// ── Users ────────────────────────────────────────────────────────────────
const storesOf = (u) => (Array.isArray(u.format_id) ? u.format_id : u.format_id ? [u.format_id] : []).map(String);
/** Users are addressed by `id`; the one legacy doc without id by its _id. */
const keyOf = (u) => (u.id != null && u.id !== '' ? String(u.id) : String(u._id));
const byKey = (key) => (ObjectId.isValid(key) && String(new ObjectId(key)) === key ? { $or: [{ id: key }, { _id: new ObjectId(key) }] } : { id: key });

const toUser = (u) => ({
  key: keyOf(u),
  id: u.id != null ? String(u.id) : '',
  name: String(u.name ?? ''),
  email: String(u.email ?? ''),
  phone: String(u.number ?? u.phone_number ?? ''),
  role: roleKey(u.role) ? String(u.role).trim() : '',
  roleKey: roleKey(u.role),
  active: u.status !== false,
  stores: storesOf(u),
  clients: clientsOf(u),
  hasPassword: !!u.password,
  mustChangePassword: u.must_change_password === true,
  createdAt: (u.createdAt instanceof Date ? u.createdAt : u.timestamp instanceof Date ? u.timestamp : null)?.toISOString() ?? null,
});

/** Editable snapshot (for audit diff). */
const snap = (u) => ({ name: u.name, email: u.email, phone: u.phone, role: u.role, active: u.active, stores: u.stores, clients: u.clients });

export async function listUsers({ q, role, client, status, page, pageSize }) {
  const all = (await users().find({}).toArray()).map(toUser); // toUser never exposes the hash
  const term = q.trim().toLowerCase();
  const c = client?.toLowerCase();
  const rows = all
    .filter((u) => (role === undefined ? true : u.roleKey === role))
    .filter((u) => (c === undefined ? true : c === '' ? !u.clients.length : u.clients.some((x) => x.toLowerCase() === c)))
    .filter((u) => (status === 'all' ? true : status === 'active' ? u.active : !u.active))
    .filter((u) => !term || [u.name, u.id, u.email, u.phone].some((v) => v.toLowerCase().includes(term)))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length };
}

async function assertEmailFree(email, exceptKey) {
  if (!email) return;
  const found = await users().find({ email: new RegExp(`^${escapeRe(email)}$`, 'i') }, { projection: { id: 1 } }).toArray();
  if (found.some((u) => keyOf(u) !== exceptKey)) throw new HttpError(409, 'Email already used by another user');
}

/** Stored spelling for a role key: existing users' most common spelling, else role doc name. */
async function roleName(key) {
  if (!key) return '';
  const doc = (await roleDocs()).get(key);
  const spellings = await users()
    .aggregate([{ $match: { role: { $type: 'string' } } }, { $group: { _id: '$role', n: { $sum: 1 } } }])
    .toArray();
  const best = spellings.filter((s) => roleKey(s._id) === key).sort((a, b) => b.n - a.n)[0];
  if (best) return String(best._id).trim();
  if (doc) return doc.name;
  throw new HttpError(400, 'Unknown role');
}

/** Suggested ID for a new user: "NE" + (highest NE number + 1), 5+ digits, e.g. NE00090. Admin may change it. */
export async function nextUserId() {
  const docs = await users().find({}, { projection: { _id: 0, id: 1, user_id: 1 } }).toArray();
  const taken = new Set(docs.flatMap((u) => [u.id, u.user_id]).filter((v) => v != null).map((v) => String(v).toUpperCase()));
  let n = 0;
  for (const v of taken) {
    const m = /^NE(\d+)$/.exec(v);
    if (m) n = Math.max(n, Number(m[1]));
  }
  let id;
  do id = `NE${String(++n).padStart(5, '0')}`;
  while (taken.has(id));
  return id;
}

export async function createUser(data, by) {
  const id = data.id.trim();
  if (await users().findOne({ $or: [{ id }, { user_id: id }] })) throw new HttpError(409, 'User ID already exists');
  if (!data.email) throw new HttpError(400, 'Email is required to sign in', { email: 'Email is required to sign in' });
  await assertEmailFree(data.email);
  const clients = await cleanClients(data.clients);
  if (!isSuperAdmin(roleKey(data.role)) && !clients.length) {
    throw new HttpError(400, 'Pick at least one client', { clients: 'Pick at least one client' });
  }
  const now = new Date();
  const role = await roleName(roleKey(data.role));
  // Same shape as main app users (format_id = assigned stores, warehouse_id = first one, user_id = id).
  const doc = {
    id,
    user_id: id,
    name: data.name,
    email: data.email,
    number: data.phone,
    role,
    status: data.active,
    format_id: data.stores,
    warehouse_id: data.stores[0] ?? '',
    clients,
    // Temporary password from admin → user must set own on first sign-in.
    password: await hashPassword(data.password),
    must_change_password: true,
    timestamp: now,
    createdAt: now,
    updatedAt: now,
    __v: 0,
  };
  await users().insertOne(doc);
  const out = toUser(doc);
  await log(by, 'user.create', { type: 'user', id: out.key, name: out.name }, { ...diff({}, snap(out)), password: { from: null, to: 'temporary' } });
  return out;
}

export async function updateUser(key, data, by) {
  const cur = await users().findOne(byKey(key));
  if (!cur) throw new HttpError(404, 'User not found');
  const before = toUser(cur);
  const self = before.key === by.id;
  const nextRoleKey = roleKey(data.role);
  // No lock-out: admins can't demote or deactivate themselves.
  if (self && nextRoleKey !== before.roleKey) throw new HttpError(400, 'You cannot change your own role');
  if (self && !data.active) throw new HttpError(400, 'You cannot deactivate yourself');
  await assertEmailFree(data.email, before.key);
  const role = nextRoleKey === before.roleKey ? before.role : await roleName(nextRoleKey);
  const clients = await cleanClients(data.clients, before.clients);
  const after = {
    ...before,
    name: data.name,
    email: data.email,
    phone: data.phone,
    role,
    roleKey: nextRoleKey,
    active: data.active,
    stores: data.stores,
    clients,
  };
  const changes = diff(snap(before), snap(after));
  if (!Object.keys(changes).length) return before;
  const set = { name: data.name, email: data.email, number: data.phone, role, status: data.active, format_id: data.stores, clients, updatedAt: new Date() };
  // Keep main app's warehouse_id in step when it mirrored the first store.
  if (changes.stores && (!cur.warehouse_id || cur.warehouse_id === before.stores[0])) set.warehouse_id = data.stores[0] ?? '';
  await users().updateOne({ _id: cur._id }, { $set: set });
  clearCaches(before.id);
  clearAccessCache(before.id);
  await log(by, 'user.update', { type: 'user', id: before.key, name: after.name }, changes);
  return after;
}

/**
 * Permanently remove a user (NHQ only). Shared `users` → also gone from the main QCR app.
 * Captures keep their user_id text. Snapshot (no password hash) kept in the change log.
 * Guards: not yourself, not the last active NHQ.
 */
export async function deleteUser(key, by) {
  const cur = await users().findOne(byKey(key));
  if (!cur) throw new HttpError(404, 'User not found');
  const u = toUser(cur);
  if (u.key === by.id) throw new HttpError(400, 'You cannot delete yourself');
  if (isSuperAdmin(u.roleKey) && u.active) {
    const nhq = (await users().find({ role: { $type: 'string' }, status: { $ne: false } }, { projection: { role: 1 } }).toArray()).filter(
      (x) => isSuperAdmin(roleKey(x.role)),
    );
    if (nhq.length <= 1) throw new HttpError(400, 'This is the last active NHQ user — cannot delete');
  }
  await users().deleteOne({ _id: cur._id });
  clearCaches(u.id);
  clearAccessCache(u.id);
  const removed = Object.fromEntries(Object.entries(snap(u)).map(([k, v]) => [k, { from: v ?? null, to: null }]));
  await log(by, 'user.delete', { type: 'user', id: u.key, name: u.name }, removed);
  return { deleted: u.key };
}

/** Admin sets a temporary password → user must replace it at next sign-in. Hash never logged. */
export async function setTemporaryPassword(key, password, by) {
  const cur = await users().findOne(byKey(key));
  if (!cur) throw new HttpError(404, 'User not found');
  const u = toUser(cur);
  if (!u.email) throw new HttpError(400, 'Add an email first — users sign in with email');
  await users().updateOne(
    { _id: cur._id },
    { $set: { password: await hashPassword(password), must_change_password: true, updatedAt: new Date() } },
  );
  await log(by, 'user.password', { type: 'user', id: u.key, name: u.name }, { password: { from: u.hasPassword ? 'set' : null, to: 'temporary' } });
  return { ...u, hasPassword: true, mustChangePassword: true };
}

// ── Roles ────────────────────────────────────────────────────────────────
/** All roles: from users (grouped) + custom docs, with permissions + user count. */
export async function listRoles() {
  const [groups, docs] = await Promise.all([
    users().aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]).toArray(),
    roleDocs(),
  ]);
  const byKey = new Map(); // key → { spellings: [{name,n}], users }
  for (const g of groups) {
    const key = roleKey(g._id);
    const r = byKey.get(key) ?? { spellings: [], users: 0 };
    if (key) r.spellings.push({ name: String(g._id).trim(), n: g.n });
    r.users += g.n;
    byKey.set(key, r);
  }
  for (const key of docs.keys()) if (!byKey.has(key)) byKey.set(key, { spellings: [], users: 0 });
  if (!byKey.has('')) byKey.set('', { spellings: [], users: 0 });
  return [...byKey.entries()]
    .map(([key, r]) => {
      const doc = docs.get(key);
      const spellings = r.spellings.sort((a, b) => b.n - a.n).map((s) => s.name);
      return {
        key,
        name: key ? (spellings[0] ?? doc?.name ?? key) : NO_ROLE_LABEL,
        variants: spellings,
        permissions: permsOf(key, doc),
        users: r.users,
        locked: isLockedRole(key),
        custom: !!doc?.custom,
        deletable: !!key && !isLockedRole(key),
      };
    })
    // Admin roles first, No role last, rest by user count.
    .sort((a, b) => {
      const rank = (r) => (r.locked ? 0 : r.key === '' ? 2 : 1);
      return rank(a) - rank(b) || b.users - a.users || a.name.localeCompare(b.name);
    });
}

export async function createRole({ name, permissions }, by) {
  const key = roleKey(name);
  if (!key) throw new HttpError(400, 'Enter a role name');
  if (isLockedRole(key) || (await listRoles()).some((r) => r.key === key)) throw new HttpError(409, 'Role already exists');
  const perms = ROLE_PERMISSIONS.filter((p) => permissions.includes(p));
  await roles().insertOne({ key, name: name.trim(), permissions: perms, custom: true, createdAt: new Date(), createdBy: by.name, updatedAt: new Date() });
  clearCaches();
  await log(by, 'role.create', { type: 'role', id: key, name: name.trim() }, { permissions: { from: null, to: perms } });
  return (await listRoles()).find((r) => r.key === key);
}

export async function updateRolePermissions(key, permissions, by) {
  if (isLockedRole(key)) throw new HttpError(400, 'Admin roles always have full access');
  const all = await listRoles();
  const role = all.find((r) => r.key === key);
  if (!role) throw new HttpError(404, 'Role not found');
  const perms = ROLE_PERMISSIONS.filter((p) => permissions.includes(p));
  await roles().updateOne(
    { key },
    { $set: { permissions: perms, updatedAt: new Date(), updatedBy: by.name }, $setOnInsert: { key, name: role.name, custom: false, createdAt: new Date() } },
    { upsert: true },
  );
  clearCaches();
  await log(by, 'role.update', { type: 'role', id: key, name: role.name }, { permissions: { from: role.permissions, to: perms } });
  return { ...role, permissions: perms };
}

/** Delete role → its users become No role (role ''). */
export async function deleteRole(key, by) {
  if (!key || isLockedRole(key)) throw new HttpError(400, 'This role cannot be deleted');
  const role = (await listRoles()).find((r) => r.key === key);
  if (!role) throw new HttpError(404, 'Role not found');
  const affected = (await users().find({ role: { $type: 'string' } }, { projection: { _id: 1, id: 1, role: 1 } }).toArray()).filter(
    (u) => roleKey(u.role) === key,
  );
  if (affected.some((u) => keyOf(u) === by.id)) throw new HttpError(400, 'You cannot delete your own role');
  if (affected.length)
    await users().updateMany({ _id: { $in: affected.map((u) => u._id) } }, { $set: { role: '', updatedAt: new Date() } });
  await roles().deleteOne({ key });
  clearCaches();
  clearAccessCache();
  await log(by, 'role.delete', { type: 'role', id: key, name: role.name }, { users: { from: affected.length, to: 0 } });
  return { moved: affected.length };
}
