// Browsing history in SQLite: one row per address (history_urls) + one row per visit (history_visits).
// Unlimited, indexed, and searchable without loading everything into memory.
const { EventEmitter } = require('events');
const db = require('./db');

const events = new EventEmitter();
let notifyTimer = null;
const notify = () => {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => events.emit('change'), 150);
};

const recordable = (url) => /^https?:\/\//i.test(url || '');

// A page load. Reloads / redirect bounces of the same page within a minute are not new visits.
function recordVisit(url, title = '', { typed = false, now = Date.now() } = {}) {
  if (!recordable(url)) return null;
  return db.tx((d) => {
    let row = d.prepare('SELECT id, last_visit FROM history_urls WHERE url = ?').get(url);
    if (row && now - row.last_visit < 60_000) {
      d.prepare('UPDATE history_urls SET last_visit = ?, title = CASE WHEN ? != \'\' THEN ? ELSE title END WHERE id = ?')
        .run(now, title, title, row.id);
      notify();
      return row.id;
    }
    if (row) {
      d.prepare(`UPDATE history_urls SET visit_count = visit_count + 1, typed_count = typed_count + ?, last_visit = ?,
                 title = CASE WHEN ? != '' THEN ? ELSE title END WHERE id = ?`)
        .run(typed ? 1 : 0, now, title, title, row.id);
    } else {
      const r = d.prepare('INSERT INTO history_urls (url, title, visit_count, typed_count, last_visit) VALUES (?, ?, 1, ?, ?)')
        .run(url, title || '', typed ? 1 : 0, now);
      row = { id: Number(r.lastInsertRowid) };
    }
    d.prepare('INSERT INTO history_visits (url_id, t) VALUES (?, ?)').run(row.id, now);
    notify();
    return row.id;
  });
}

function updatePage(url, { title, favicon } = {}) {
  if (!recordable(url)) return;
  const d = db.get();
  if (title) d.prepare('UPDATE history_urls SET title = ? WHERE url = ?').run(title, url);
  if (favicon) d.prepare('UPDATE history_urls SET favicon = ? WHERE url = ?').run(favicon, url);
  notify();
}

// Latest pages, one per address (history popup).
function recent(limit = 15) {
  return db.get().prepare(`SELECT url, title, favicon, last_visit AS t FROM history_urls
                           ORDER BY last_visit DESC LIMIT ?`).all(limit);
}

// Individual visits, newest first, optionally filtered (History page).
function query({ q = '', offset = 0, limit = 200 } = {}) {
  const like = `%${String(q).replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const rows = db.get().prepare(`
    SELECT v.id, v.t, u.url, u.title, u.favicon
    FROM history_visits v JOIN history_urls u ON u.id = v.url_id
    WHERE (? = '' OR u.title LIKE ? ESCAPE '\\' OR u.url LIKE ? ESCAPE '\\')
    ORDER BY v.t DESC LIMIT ? OFFSET ?`).all(q, like, like, limit + 1, offset);
  return { items: rows.slice(0, limit), more: rows.length > limit };
}

function deleteVisits(ids) {
  const list = (ids || []).map(Number).filter(Number.isFinite);
  if (!list.length) return;
  db.tx((d) => {
    const del = d.prepare('DELETE FROM history_visits WHERE id = ?');
    for (const id of list) del.run(id);
    // Addresses with no visits left disappear; others get their counters fixed.
    d.exec(`DELETE FROM history_urls WHERE id NOT IN (SELECT DISTINCT url_id FROM history_visits);
            UPDATE history_urls SET
              visit_count = (SELECT COUNT(*) FROM history_visits WHERE url_id = history_urls.id),
              last_visit = (SELECT MAX(t) FROM history_visits WHERE url_id = history_urls.id);`);
  });
  notify();
}

function deleteUrl(url) {
  db.get().prepare('DELETE FROM history_urls WHERE url = ?').run(url);
  notify();
}

function clear() {
  db.get().exec('DELETE FROM history_visits; DELETE FROM history_urls;');
  notify();
}

// Address-bar matches: pages whose URL or title contain the text, best first.
// Score ("frecency") = how often + how recently + typed by hand.
function match(text, limit = 6, now = Date.now()) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return [];
  const like = `%${t.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const hostPrefix = t.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const rows = db.get().prepare(`
    SELECT url, title, favicon, visit_count, typed_count, last_visit FROM history_urls
    WHERE url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
    ORDER BY last_visit DESC LIMIT 400`).all(like, like);
  const scored = rows.map((r) => {
    const days = (now - r.last_visit) / 864e5;
    const recency = days < 1 ? 100 : days < 4 ? 70 : days < 14 ? 50 : days < 31 ? 30 : days < 90 ? 10 : 2;
    let score = (r.visit_count + r.typed_count * 2) * recency;
    const host = (() => { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    if (host.startsWith(hostPrefix)) score *= 4; // "you" → youtube.com wins
    if (new URL(r.url).pathname === '/' ) score *= 1.5;
    return { url: r.url, title: r.title, favicon: r.favicon, score, host };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Bulk import (migration from the old storage). entries: [{ url, title, favicon, t }]
function importEntries(entries) {
  db.tx((d) => {
    const getUrl = d.prepare('SELECT id FROM history_urls WHERE url = ?');
    const insUrl = d.prepare('INSERT INTO history_urls (url, title, favicon, visit_count, last_visit) VALUES (?, ?, ?, 0, ?)');
    const insVisit = d.prepare('INSERT INTO history_visits (url_id, t) VALUES (?, ?)');
    for (const e of entries) {
      if (!recordable(e.url) || !Number.isFinite(e.t)) continue;
      let row = getUrl.get(e.url);
      if (!row) row = { id: Number(insUrl.run(e.url, e.title || '', e.favicon || null, e.t).lastInsertRowid) };
      insVisit.run(row.id, e.t);
    }
    d.exec(`UPDATE history_urls SET
              visit_count = (SELECT COUNT(*) FROM history_visits WHERE url_id = history_urls.id),
              last_visit = (SELECT MAX(t) FROM history_visits WHERE url_id = history_urls.id);`);
  });
  notify();
}

module.exports = { recordVisit, updatePage, recent, query, deleteVisits, deleteUrl, clear, match, importEntries,
  on: (...a) => events.on(...a) };
