// SQLite storage (Node's built-in node:sqlite — no native modules to rebuild).
// One file: <userData>/browser.db. Schema changes go in MIGRATIONS, applied in order via PRAGMA user_version.
const { DatabaseSync } = require('node:sqlite');

let db = null;

const MIGRATIONS = [
  // v1 — Phase 1
  `
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE history_urls (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    favicon TEXT,
    visit_count INTEGER NOT NULL DEFAULT 0,
    typed_count INTEGER NOT NULL DEFAULT 0,
    last_visit INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX history_urls_last ON history_urls(last_visit DESC);

  CREATE TABLE history_visits (
    id INTEGER PRIMARY KEY,
    url_id INTEGER NOT NULL REFERENCES history_urls(id) ON DELETE CASCADE,
    t INTEGER NOT NULL
  );
  CREATE INDEX history_visits_t ON history_visits(t DESC);
  CREATE INDEX history_visits_url ON history_visits(url_id);

  CREATE TABLE favorites (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    favicon TEXT,
    position INTEGER NOT NULL
  );

  CREATE TABLE closed_actions (
    id INTEGER PRIMARY KEY,
    t INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE downloads (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    url TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    received INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL,
    time INTEGER NOT NULL
  );
  `,
  // v2 — passwords + form autofill. Secrets are encrypted with the macOS Keychain key (Electron safeStorage).
  `
  CREATE TABLE credentials (
    id INTEGER PRIMARY KEY,
    origin TEXT NOT NULL,
    username TEXT NOT NULL,
    password BLOB NOT NULL,
    created INTEGER NOT NULL,
    last_used INTEGER NOT NULL DEFAULT 0,
    times_used INTEGER NOT NULL DEFAULT 0,
    UNIQUE (origin, username)
  );
  CREATE INDEX credentials_origin ON credentials(origin);
  CREATE TABLE password_never (origin TEXT PRIMARY KEY, t INTEGER NOT NULL);
  CREATE TABLE form_profiles (
    id INTEGER PRIMARY KEY,
    data BLOB NOT NULL,
    created INTEGER NOT NULL,
    last_used INTEGER NOT NULL DEFAULT 0
  );
  `,
];

function open(file) {
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

function get() {
  if (!db) throw new Error('database not open');
  return db;
}

// Run fn inside one transaction (all-or-nothing, and much faster for bulk writes).
function tx(fn) {
  const d = get();
  d.exec('BEGIN');
  try {
    const out = fn(d);
    d.exec('COMMIT');
    return out;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

// Small key/value store for settings and flags (values are JSON).
const kv = {
  get(key, fallback) {
    const row = get().prepare('SELECT value FROM kv WHERE key = ?').get(key);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return fallback; }
  },
  set(key, value) {
    get().prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  },
  delete(key) { get().prepare('DELETE FROM kv WHERE key = ?').run(key); },
};

function close() {
  try { db?.close(); } catch {}
  db = null;
}

module.exports = { open, get, tx, kv, close };
