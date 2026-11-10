// The New Tab page's own background picture (Settings → New tab page). One copy lives in the app's data folder,
// served as pb://shared/newtab-bg. The original file is never touched.
const { app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' };
const MAX = 25 * 1024 * 1024;
const BASE = 'newtab-background';

const dir = () => app.getPath('userData');
function current() {
  for (const ext of Object.keys(TYPES)) {
    const file = path.join(dir(), BASE + ext);
    if (fs.existsSync(file)) return { file, type: TYPES[ext] };
  }
  return null;
}
function removeAll() { for (const ext of Object.keys(TYPES)) fs.rmSync(path.join(dir(), BASE + ext), { force: true }); }

// Copy a picture in and switch the background to it. Returns an error text, or null.
function useFile(src) {
  const ext = path.extname(String(src || '')).toLowerCase();
  if (!TYPES[ext]) return 'Pick a PNG, JPEG, WebP, GIF or AVIF picture';
  let size;
  try { size = fs.statSync(src).size; } catch { return 'That file can’t be read'; }
  if (size > MAX) return 'That picture is too big (25 MB at most)';
  removeAll();
  fs.copyFileSync(src, path.join(dir(), BASE + ext));
  settings.set({ ntImage: Date.now(), ntBackground: 'image' });
  return null;
}

async function choose(win) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win?.base, {
    title: 'Background for the New Tab page', properties: ['openFile'],
    filters: [{ name: 'Pictures', extensions: Object.keys(TYPES).map((e) => e.slice(1)) }],
  });
  if (canceled || !filePaths[0]) return null;
  return useFile(filePaths[0]);
}

function clear() {
  removeAll();
  settings.set({ ntImage: 0, ...(settings.get('ntBackground') === 'image' ? { ntBackground: 'plain' } : {}) });
}

module.exports = { current, useFile, choose, clear };
