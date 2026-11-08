// Favorites bar, stored in SQLite with an explicit order.
const { EventEmitter } = require('events');
const db = require('./db');

const events = new EventEmitter();
const changed = () => events.emit('change', list());

// Same page despite a trailing slash or #fragment.
const key = (u) => String(u || '').replace(/#.*$/, '').replace(/\/$/, '');

function list() {
  return db.get().prepare('SELECT id, url, title, favicon FROM favorites ORDER BY position, id').all();
}

function findByUrl(url) {
  return list().find((f) => key(f.url) === key(url)) || null;
}

function add({ url, title = '', favicon = null }) {
  if (!/^https?:|^file:/i.test(url || '')) throw new Error('Only web addresses can be favorites');
  const existing = findByUrl(url);
  if (existing) return existing;
  const pos = db.get().prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM favorites').get().p;
  const r = db.get().prepare('INSERT INTO favorites (url, title, favicon, position) VALUES (?, ?, ?, ?)')
    .run(url, String(title), favicon, pos);
  changed();
  return { id: Number(r.lastInsertRowid), url, title: String(title), favicon };
}

// Name may be empty (the bar then shows just the icon).
function update(id, { url, title, favicon } = {}) {
  const f = db.get().prepare('SELECT * FROM favorites WHERE id = ?').get(id);
  if (!f) return null;
  const next = {
    url: url !== undefined ? url : f.url,
    title: title !== undefined ? String(title) : f.title,
    favicon: favicon !== undefined ? favicon : f.favicon,
  };
  if (!/^https?:|^file:/i.test(next.url)) throw new Error('Invalid address');
  db.get().prepare('UPDATE favorites SET url = ?, title = ?, favicon = ? WHERE id = ?').run(next.url, next.title, next.favicon, id);
  changed();
  return { id, ...next };
}

function remove(id) {
  db.get().prepare('DELETE FROM favorites WHERE id = ?').run(id);
  changed();
}

// ids in their new order
function reorder(ids) {
  db.tx((d) => {
    const st = d.prepare('UPDATE favorites SET position = ? WHERE id = ?');
    ids.forEach((id, i) => st.run(i, id));
  });
  changed();
}

// Fill in a missing icon once we see the page's favicon.
function noteFavicon(url, favicon) {
  if (!favicon) return;
  const f = findByUrl(url);
  if (f && !f.favicon) update(f.id, { favicon });
}

function importList(items) {
  db.tx((d) => {
    const st = d.prepare('INSERT INTO favorites (url, title, favicon, position) VALUES (?, ?, ?, ?)');
    items.forEach((f, i) => { if (/^https?:|^file:/i.test(f.url || '')) st.run(f.url, String(f.title ?? ''), f.favicon || null, i); });
  });
  changed();
}

module.exports = { list, findByUrl, add, update, remove, reorder, noteFavicon, importList, key,
  on: (...a) => events.on(...a) };
