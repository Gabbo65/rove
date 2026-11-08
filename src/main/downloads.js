// Downloads: save straight to the download folder (like Edge), track progress, keep a list.
// Finished downloads from normal windows are remembered (SQLite); private-window downloads are not.
const { app, shell } = require('electron');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const settings = require('./settings');

const events = new EventEmitter();
const items = [];             // newest first: { id, name, path, url, total, received, state, paused, time, private, sessionId }
const live = new Map();       // id -> DownloadItem while in progress
let seq = 0;
let pushTimer = null;

function load() {
  const rows = db.get().prepare('SELECT * FROM downloads ORDER BY time DESC LIMIT 100').all();
  for (const r of rows) {
    items.push({ id: ++seq, dbId: r.id, name: r.name, path: r.path, url: r.url, total: r.total,
      received: r.received, state: r.state, paused: false, time: r.time, private: false });
  }
}

function folder() {
  const custom = settings.get('downloadDir');
  if (custom && fs.existsSync(custom)) return custom;
  return app.getPath('downloads');
}

// "file.pdf" → "file (1).pdf" if taken (on disk or by a download in progress).
function uniquePath(dir, name) {
  const clean = String(name || 'download').replace(/[/\\:]/g, '_').replace(/^\.+/, '') || 'download';
  const ext = path.extname(clean), base = path.basename(clean, ext);
  let p = path.join(dir, clean), n = 1;
  while (fs.existsSync(p) || items.some((d) => d.path === p && d.state === 'progressing')) {
    p = path.join(dir, `${base} (${n++})${ext}`);
  }
  return p;
}

// Hook a session (default, or a private window's) so its downloads are tracked.
const hooked = new WeakSet();
function attachSession(ses, { isPrivate = false } = {}) {
  if (hooked.has(ses)) return;
  hooked.add(ses);
  ses.on('will-download', (_e, item) => {
    if (!settings.get('askDownloadLocation')) item.setSavePath(uniquePath(folder(), item.getFilename()));
    else item.setSaveDialogOptions({ defaultPath: path.join(folder(), item.getFilename() || 'download') });
    const d = { id: ++seq, name: item.getFilename(), path: item.getSavePath(), url: item.getURL(),
      total: item.getTotalBytes(), received: 0, state: 'progressing', paused: false, time: Date.now(), private: isPrivate };
    items.unshift(d);
    live.set(d.id, item);
    item.on('updated', (_ev, state) => {
      if (item.getSavePath()) { d.path = item.getSavePath(); d.name = path.basename(d.path); }
      d.received = item.getReceivedBytes();
      d.total = item.getTotalBytes();
      d.paused = item.isPaused();
      d.state = state === 'interrupted' ? 'interrupted' : 'progressing';
      push();
    });
    item.once('done', (_ev, state) => {
      if (item.getSavePath()) { d.path = item.getSavePath(); d.name = path.basename(d.path); }
      d.received = item.getReceivedBytes();
      d.state = state; // completed | cancelled | interrupted
      d.paused = false;
      live.delete(d.id);
      if (state === 'completed' && process.platform === 'darwin') app.dock?.downloadFinished(d.path);
      if (!d.private) save(d);
      push();
    });
    push({ open: true });
  });
}

function save(d) {
  const r = db.get().prepare('INSERT INTO downloads (name, path, url, total, received, state, time) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(d.name, d.path, d.url, d.total, d.received, d.state, d.time);
  d.dbId = Number(r.lastInsertRowid);
  db.get().prepare('DELETE FROM downloads WHERE id NOT IN (SELECT id FROM downloads ORDER BY time DESC LIMIT 100)').run();
}

function unsave(d) {
  if (d.dbId) db.get().prepare('DELETE FROM downloads WHERE id = ?').run(d.dbId);
}

function list() {
  return items.slice(0, 100).map(({ dbId, ...d }) => ({ ...d, missing: d.state === 'completed' && !fs.existsSync(d.path) }));
}

function push({ open = false } = {}) {
  const send = () => { pushTimer = null; events.emit('change', { list: list(), open, progress: progress() }); };
  if (open) { clearTimeout(pushTimer); return send(); }
  if (!pushTimer) pushTimer = setTimeout(send, 200);
}

// Overall progress 0..1 of running downloads, or -1 when none (for the Dock icon).
function progress() {
  const running = items.filter((d) => d.state === 'progressing' && d.total > 0);
  if (!running.length) return -1;
  return running.reduce((a, d) => a + d.received, 0) / running.reduce((a, d) => a + d.total, 0);
}

// retry needs a webContents to start the download from (the caller passes the active tab's).
function action(id, name, { retryFrom } = {}) {
  if (name === 'clear') {
    for (let i = items.length - 1; i >= 0; i--) if (items[i].state !== 'progressing') { unsave(items[i]); items.splice(i, 1); }
    return push();
  }
  const d = items.find((x) => x.id === id);
  if (!d) return;
  const item = live.get(id);
  if (name === 'open') shell.openPath(d.path);
  else if (name === 'show') shell.showItemInFolder(d.path);
  else if (name === 'pause') item?.pause();
  else if (name === 'resume') { if (item?.canResume()) item.resume(); }
  else if (name === 'cancel') item?.cancel();
  else if (name === 'retry') retryFrom?.downloadURL(d.url);
  else if (name === 'remove') { if (d.state !== 'progressing') { unsave(d); items.splice(items.indexOf(d), 1); } }
  push();
}

// A private window closed: forget its downloads (the files stay on disk).
function forgetPrivate() {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].private && items[i].state !== 'progressing') items.splice(i, 1);
  push();
}

function importList(saved) {
  db.tx((d) => {
    const st = d.prepare('INSERT INTO downloads (name, path, url, total, received, state, time) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const x of saved) {
      if (!x || !x.path || !x.state) continue;
      st.run(String(x.name || path.basename(x.path)), x.path, String(x.url || ''), x.total || 0, x.received || 0, x.state, x.time || Date.now());
    }
  });
  items.length = 0;
  load();
  push();
}

module.exports = { load, attachSession, list, action, progress, forgetPrivate, importList, folder,
  on: (...a) => events.on(...a) };
