// Saved passwords and form data (addresses, contact details).
// Secrets are encrypted with Electron safeStorage (key kept in the macOS Keychain) before they touch the
// database; if encryption isn't available we refuse to save rather than store plain text.
const { safeStorage } = require('electron');
const { EventEmitter } = require('events');
const db = require('./db');

const events = new EventEmitter();
const changed = () => events.emit('change');

const available = async () => { try { return !!(await safeStorage.isAsyncEncryptionAvailable()); } catch { return false; } };
async function encrypt(text) {
  if (!(await available())) throw new Error('Encryption is not available — not saving');
  return safeStorage.encryptStringAsync(String(text));
}
async function decrypt(buf) {
  const out = await safeStorage.decryptStringAsync(Buffer.from(buf));
  return typeof out === 'string' ? out : out.result;
}

// ---------- passwords ----------
function forOrigin(origin) {
  return db.get().prepare('SELECT id, username, last_used FROM credentials WHERE origin = ? ORDER BY last_used DESC, username')
    .all(String(origin));
}

function list() {
  return db.get().prepare('SELECT id, origin, username, created, last_used, times_used FROM credentials ORDER BY origin, username').all();
}

// Same username on the same site → password updated. Returns 'saved' | 'updated' | 'unchanged'.
async function save({ origin, username, password }) {
  origin = String(origin || ''); username = String(username || ''); password = String(password || '');
  if (!/^https?:\/\//.test(origin) || !password) throw new Error('Invalid credential');
  const existing = db.get().prepare('SELECT id, password FROM credentials WHERE origin = ? AND username = ?').get(origin, username);
  if (existing) {
    if ((await decrypt(existing.password)) === password) return 'unchanged';
    db.get().prepare('UPDATE credentials SET password = ? WHERE id = ?').run(await encrypt(password), existing.id);
    changed();
    return 'updated';
  }
  db.get().prepare('INSERT INTO credentials (origin, username, password, created) VALUES (?, ?, ?, ?)')
    .run(origin, username, await encrypt(password), Date.now());
  changed();
  return 'saved';
}

// Would saving this change anything? (no prompt for a password we already have)
async function isKnown({ origin, username, password }) {
  const row = db.get().prepare('SELECT password FROM credentials WHERE origin = ? AND username = ?').get(String(origin), String(username || ''));
  return !!row && (await decrypt(row.password)) === String(password);
}

// The password itself — only for filling into the SAME site, or for revealing after the user authenticates.
async function password(id, { origin } = {}) {
  const row = db.get().prepare('SELECT origin, password FROM credentials WHERE id = ?').get(Number(id));
  if (!row) return null;
  if (origin !== undefined && row.origin !== origin) return null;
  return decrypt(row.password);
}

function markUsed(id) {
  db.get().prepare('UPDATE credentials SET last_used = ?, times_used = times_used + 1 WHERE id = ?').run(Date.now(), Number(id));
}

async function update(id, { username, password: pw } = {}) {
  const row = db.get().prepare('SELECT id FROM credentials WHERE id = ?').get(Number(id));
  if (!row) return false;
  if (username !== undefined) db.get().prepare('UPDATE credentials SET username = ? WHERE id = ?').run(String(username), row.id);
  if (pw) db.get().prepare('UPDATE credentials SET password = ? WHERE id = ?').run(await encrypt(pw), row.id);
  changed();
  return true;
}

function remove(id) { db.get().prepare('DELETE FROM credentials WHERE id = ?').run(Number(id)); changed(); }

// "Never save for this site"
const never = {
  has: (origin) => !!db.get().prepare('SELECT 1 FROM password_never WHERE origin = ?').get(String(origin)),
  add: (origin) => { db.get().prepare('INSERT OR IGNORE INTO password_never (origin, t) VALUES (?, ?)').run(String(origin), Date.now()); changed(); },
  remove: (origin) => { db.get().prepare('DELETE FROM password_never WHERE origin = ?').run(String(origin)); changed(); },
  list: () => db.get().prepare('SELECT origin FROM password_never ORDER BY origin').all().map((r) => r.origin),
};

// ---------- form data (addresses / contact) ----------
const FORM_FIELDS = ['name', 'given-name', 'family-name', 'email', 'tel', 'organization',
  'street-address', 'address-level2', 'address-level1', 'postal-code', 'country'];

function cleanProfile(data) {
  const out = {};
  for (const k of FORM_FIELDS) if (data && typeof data[k] === 'string' && data[k].trim()) out[k] = data[k].trim().slice(0, 200);
  return out;
}

async function profiles() {
  const rows = db.get().prepare('SELECT id, data, last_used FROM form_profiles ORDER BY last_used DESC, id DESC').all();
  const out = [];
  for (const r of rows) {
    try { out.push({ id: r.id, ...JSON.parse(await decrypt(r.data)) }); } catch {}
  }
  return out;
}

// Same person (email or name+street) → merged into the existing profile. Returns the profile id.
async function saveProfile(data) {
  const clean = cleanProfile(data);
  if (Object.keys(clean).length < 2) return null;
  const same = (await profiles()).find((p) => (clean.email && p.email === clean.email)
    || (clean.name && p.name === clean.name && (!clean['street-address'] || p['street-address'] === clean['street-address'])));
  if (same) {
    const { id, ...old } = same;
    const merged = { ...old, ...clean };
    db.get().prepare('UPDATE form_profiles SET data = ? WHERE id = ?').run(await encrypt(JSON.stringify(merged)), id);
    changed();
    return id;
  }
  const r = db.get().prepare('INSERT INTO form_profiles (data, created) VALUES (?, ?)').run(await encrypt(JSON.stringify(clean)), Date.now());
  changed();
  return Number(r.lastInsertRowid);
}

async function updateProfile(id, data) {
  const clean = cleanProfile(data);
  db.get().prepare('UPDATE form_profiles SET data = ? WHERE id = ?').run(await encrypt(JSON.stringify(clean)), Number(id));
  changed();
}

async function profile(id) {
  const r = db.get().prepare('SELECT data FROM form_profiles WHERE id = ?').get(Number(id));
  if (!r) return null;
  db.get().prepare('UPDATE form_profiles SET last_used = ? WHERE id = ?').run(Date.now(), Number(id));
  return JSON.parse(await decrypt(r.data));
}

function removeProfile(id) { db.get().prepare('DELETE FROM form_profiles WHERE id = ?').run(Number(id)); changed(); }

module.exports = { available, forOrigin, list, save, isKnown, password, markUsed, update, remove, never,
  FORM_FIELDS, profiles, saveProfile, updateProfile, profile, removeProfile, on: (...a) => events.on(...a) };
