// Export / import "your setup": look, layout, glass, New Tab page and custom CSS as one JSON file,
// to share with friends or move to another computer. Never passwords, history or anything private.
const { dialog } = require('electron');
const fs = require('fs');
const settings = require('./settings');

const KEYS = [...settings.LOOK_KEYS, ...settings.NEWTAB_KEYS.filter((k) => k !== 'ntImage'),
  'toolbarLayout', 'showFavoritesBar', 'customCss'];
const MAX = 1024 * 1024;

function data() {
  const all = settings.all();
  return { app: 'rove', kind: 'setup', version: 1, settings: Object.fromEntries(KEYS.map((k) => [k, all[k]])) };
}

// Applies a setup object. Only known keys, each checked by the settings schema. Returns the keys applied.
function apply(obj) {
  if (!obj || obj.app !== 'rove' || obj.kind !== 'setup' || typeof obj.settings !== 'object') throw new Error('This isn’t a Rove setup file');
  const patch = {};
  for (const k of KEYS) if (k in obj.settings) patch[k] = obj.settings[k];
  if (patch.ntBackground === 'image') delete patch.ntBackground; // the picture itself isn't in the file
  return Object.keys(settings.set(patch));
}

async function exportTo(win) {
  const { canceled, filePath } = await dialog.showSaveDialog(win?.base, { title: 'Export your Rove setup', defaultPath: 'rove-setup.json',
    filters: [{ name: 'Rove setup', extensions: ['json'] }] });
  if (canceled || !filePath) return { canceled: true };
  fs.writeFileSync(filePath, JSON.stringify(data(), null, 2));
  return { ok: true };
}

async function importFrom(win) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win?.base, { title: 'Import a Rove setup', properties: ['openFile'],
    filters: [{ name: 'Rove setup', extensions: ['json'] }] });
  if (canceled || !filePaths[0]) return { canceled: true };
  return importFile(filePaths[0]);
}

function importFile(file) {
  try {
    if (fs.statSync(file).size > MAX) return { error: 'That file is too big to be a Rove setup' };
    return { ok: true, applied: apply(JSON.parse(fs.readFileSync(file, 'utf8'))) };
  } catch (e) { return { error: e instanceof SyntaxError ? 'That file isn’t valid JSON' : e.message }; }
}

module.exports = { KEYS, data, apply, exportTo, importFrom, importFile };
