// "Reopen closed tab" history. Each entry is ONE closing action (a tab, "close others", a whole window).
// Normal windows share a persistent stack; each private window keeps its own in memory (gone when it closes).
const db = require('./db');

const MAX = 30;

class PersistentStack {
  push(action) {
    if (!action?.tabs?.length) return;
    db.tx((d) => {
      d.prepare('INSERT INTO closed_actions (t, data) VALUES (?, ?)').run(Date.now(), JSON.stringify(action));
      d.prepare(`DELETE FROM closed_actions WHERE id NOT IN (SELECT id FROM closed_actions ORDER BY id DESC LIMIT ${MAX})`).run();
    });
  }
  pop() {
    const row = db.get().prepare('SELECT id, data FROM closed_actions ORDER BY id DESC LIMIT 1').get();
    if (!row) return null;
    db.get().prepare('DELETE FROM closed_actions WHERE id = ?').run(row.id);
    try { return JSON.parse(row.data); } catch { return null; }
  }
  list(limit = MAX) {
    return db.get().prepare('SELECT id, t, data FROM closed_actions ORDER BY id DESC LIMIT ?').all(limit)
      .map((r) => ({ id: r.id, t: r.t, ...JSON.parse(r.data) }));
  }
  remove(id) { db.get().prepare('DELETE FROM closed_actions WHERE id = ?').run(id); }
  get size() { return db.get().prepare('SELECT COUNT(*) AS n FROM closed_actions').get().n; }
}

class MemoryStack {
  constructor() { this.items = []; this.seq = 0; }
  push(action) {
    if (!action?.tabs?.length) return;
    this.items.push({ id: ++this.seq, t: Date.now(), ...action });
    if (this.items.length > MAX) this.items.shift();
  }
  pop() { return this.items.pop() || null; }
  list(limit = MAX) { return this.items.slice(-limit).reverse(); }
  remove(id) { this.items = this.items.filter((a) => a.id !== id); }
  get size() { return this.items.length; }
}

const shared = new PersistentStack();

module.exports = { shared, MemoryStack };
