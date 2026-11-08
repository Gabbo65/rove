// One-time import of data from the old version (favorites, history, closed tabs lived in the UI's
// localStorage under the file:// origin; downloads in downloads.json). Runs once, then never again.
const { BrowserWindow, ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { PRELOAD, MIGRATE_HTML } = require('./paths');
const db = require('./db');
const favorites = require('./favorites');
const history = require('./history');
const downloads = require('./downloads');
const settings = require('./settings');
const closed = require('./closed');

const FLAG = 'migrated.localStorage.v1';

function readOldLocalStorage(timeout = 5000) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({ show: false, webPreferences: { preload: PRELOAD.migrate, contextIsolation: true, sandbox: true } });
    let done = false;
    const finish = (data) => {
      if (done) return;
      done = true;
      ipcMain.removeListener('migrate:data', onData);
      clearTimeout(timer);
      if (!win.isDestroyed()) win.destroy();
      resolve(data);
    };
    const onData = (e, data) => { if (e.sender === win.webContents) finish(data); };
    ipcMain.on('migrate:data', onData);
    const timer = setTimeout(() => finish(null), timeout);
    win.loadFile(MIGRATE_HTML).catch(() => finish(null));
  });
}

const parse = (s, fallback) => { try { return JSON.parse(s) ?? fallback; } catch { return fallback; } };

async function run() {
  if (db.kv.get(FLAG)) return { skipped: true };
  const result = { favorites: 0, history: 0, closed: 0, downloads: 0 };
  const data = await readOldLocalStorage();
  if (data) {
    const favs = parse(data.favorites, []);
    if (Array.isArray(favs) && favs.length && favorites.list().length === 0) {
      favorites.importList(favs.map((f) => ({ url: f.url, title: f.title ?? '', favicon: f.favicon || null })));
      result.favorites = favs.length;
    }
    const hist = parse(data.history, []);
    if (Array.isArray(hist) && hist.length) {
      // Old list is newest-first; import oldest-first so counters end right.
      history.importEntries(hist.slice().reverse().map((h) => ({ url: h.url, title: h.title, favicon: h.favicon, t: h.t })));
      result.history = hist.length;
    }
    const actions = parse(data.closeHistory, []);
    if (Array.isArray(actions)) {
      for (const a of actions) {
        if (!a?.tabs?.length) continue;
        closed.shared.push({ tabs: a.tabs.map((t) => ({ url: t.url, index: t.index || 0 })), activeUrl: a.active || null });
        result.closed++;
      }
    }
    const favbar = parse(data.favbar, null);
    if (typeof favbar === 'boolean') settings.set({ showFavoritesBar: favbar });
  }
  const dlFile = path.join(app.getPath('userData'), 'downloads.json');
  if (fs.existsSync(dlFile)) {
    const saved = parse(fs.readFileSync(dlFile, 'utf8'), []);
    if (Array.isArray(saved) && saved.length) { downloads.importList(saved.reverse()); result.downloads = saved.length; }
    fs.renameSync(dlFile, dlFile + '.imported');
  }
  db.kv.set(FLAG, { at: Date.now(), ...result });
  return result;
}

module.exports = { run, FLAG };
