// Updates, two kinds:
// • "source" — you run the browser from its project folder (or an app built from it): we check the newest
//   Electron (npm registry); "Update now" runs scripts/update-engine.sh in Terminal: upgrade Electron → run all
//   tests → rebuild + reinstall only if they pass. The browser is only as safe as its Chromium engine.
// • "release" — a downloaded build (GitHub Releases): we check the newest release of this app; "Update now"
//   opens its download page. Each release ships with the current engine.
const { app, net, shell, dialog, BaseWindow } = require('electron');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./paths');
const db = require('./db');
const settings = require('./settings');

const events = new EventEmitter();
const DAY = 24 * 3600_000;
const SUPPORTED_MAJORS = 3; // Electron supports the latest 3 major versions with security fixes
let timer = null;

const parse = (v) => String(v || '').replace(/^v/, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
function compare(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// Pure decision, easy to test.
function evaluate(current, latest) {
  if (!latest) return 'unknown';
  if (compare(latest, current) <= 0) return 'up-to-date';
  return parse(latest)[0] - parse(current)[0] >= SUPPORTED_MAJORS ? 'unsupported' : 'update-available';
}

const REPO = 'Gabbo65/rove';
const mode = () => process.env.PB_UPDATE_MODE || (sourceDir() ? 'source' : 'release');

function state() {
  const saved = db.kv.get('updates', null);
  const m = mode();
  const current = m === 'release' ? app.getVersion() : process.versions.electron;
  const latest = saved?.mode === m ? saved?.latest || null : null;
  const status = m === 'release' ? (latest && compare(latest, current) > 0 ? 'update-available' : latest ? 'up-to-date' : 'unknown')
    : evaluate(current, latest);
  return { mode: m, current, appVersion: app.getVersion(), electron: process.versions.electron, chromium: process.versions.chrome,
    latest, status, releaseUrl: saved?.releaseUrl || `https://github.com/${REPO}/releases/latest`,
    checkedAt: saved?.checkedAt || 0, error: saved?.error || null };
}

async function check() {
  const m = mode();
  const url = process.env.PB_UPDATE_URL || (m === 'release' ? `https://api.github.com/repos/${REPO}/releases/latest` : 'https://registry.npmjs.org/electron/latest');
  try {
    const res = await net.fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(res.status === 404 && m === 'release' ? 'no releases published yet' : `HTTP ${res.status}`);
    const body = await res.json();
    const version = String((m === 'release' ? body.tag_name : body.version) || '').replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error('bad version');
    const releaseUrl = m === 'release' && /^https:\/\/github\.com\//.test(body.html_url || '') ? body.html_url : null;
    db.kv.set('updates', { mode: m, latest: version, releaseUrl, checkedAt: Date.now(), error: null });
  } catch (err) {
    const prev = db.kv.get('updates', {}) || {};
    db.kv.set('updates', { ...(prev.mode === m ? prev : { mode: m }), checkedAt: Date.now(), error: String(err.message || err) });
  }
  const s = state();
  events.emit('change', s);
  return s;
}

function start() {
  clearInterval(timer);
  if (process.env.PB_TEST) return; // tests call check() themselves
  const due = () => settings.get('updateCheck') && Date.now() - state().checkedAt > DAY;
  setTimeout(() => { if (due()) check(); else events.emit('change', state()); }, 15_000);
  timer = setInterval(() => { if (due()) check(); }, 3600_000);
  timer.unref?.();
}

// Where the project source lives (packaged apps remember it in build-info.json, written when packaging).
function sourceDir() {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'main', 'build-info.json'), 'utf8'));
    if (info.sourceDir && fs.existsSync(path.join(info.sourceDir, 'package.json'))) return info.sourceDir;
  } catch {}
  return fs.existsSync(path.join(ROOT, 'package.json')) && !ROOT.includes('app.asar') ? ROOT : null;
}

// Open Terminal running the update script (you see every step; nothing is installed if tests fail).
async function runUpdate() {
  if (mode() === 'release') { await shell.openExternal(state().releaseUrl); return true; }
  if (process.platform !== 'darwin') {
    await dialog.showMessageBox({ type: 'info', message: 'Update the engine from the project folder',
      detail: 'Run: npm install electron@latest && npm test — then build again.' });
    return false;
  }
  const dir = sourceDir();
  if (!dir) {
    await dialog.showMessageBox({ type: 'warning', message: 'Can’t find the browser’s source folder',
      detail: 'Update from the project folder with: npm run update-engine' });
    return false;
  }
  const script = path.join(app.getPath('userData'), 'update-engine.command');
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  fs.writeFileSync(script, `#!/bin/zsh -l\ncd ${q(dir)} || exit 1\nnpm run update-engine\necho\necho "Done. You can close this window."\n`, { mode: 0o755 });
  const err = await shell.openPath(script);
  return !err;
}

// Toolbar "Update" button → explain and offer to update.
async function prompt() {
  const s = state();
  const parent = BaseWindow.getFocusedWindow() || undefined;
  if (s.mode === 'release') {
    const opts = { type: 'info', buttons: s.status === 'update-available' ? ['Download', 'Later'] : ['Check again', 'OK'], defaultId: 0, cancelId: 1,
      message: s.status === 'update-available' ? `Rove ${s.latest} is available` : s.status === 'up-to-date' ? 'Rove is up to date' : 'Couldn’t check for updates',
      detail: [`You have ${s.current} (Chromium ${s.chromium}).`, s.error && `Last check failed: ${s.error}`].filter(Boolean).join('\n') };
    const { response } = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
    if (response !== 0) return false;
    if (s.status === 'update-available') return runUpdate();
    const n = await check(); if (n.status === 'update-available') return prompt();
    return false;
  }
  const urgent = s.status === 'unsupported';
  const detail = [
    `Engine now: Electron ${s.current} (Chromium ${s.chromium})`,
    s.latest ? `Newest: Electron ${s.latest}` : 'Newest: not checked yet',
    urgent ? '\nThis version no longer gets security fixes. Update soon.' : '',
    '\n“Update now” opens Terminal: it upgrades the engine, runs all tests, and reinstalls the app only if every test passes. Then restart the browser.',
  ].join('\n');
  const opts = { type: urgent ? 'warning' : 'info', buttons: ['Update now', 'Check again', 'Later'], defaultId: 0, cancelId: 2,
    message: s.status === 'up-to-date' ? 'Your browser engine is up to date' : 'A newer browser engine is available', detail };
  const { response } = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
  if (response === 0) return runUpdate();
  if (response === 1) { const n = await check(); if (n.status !== 'up-to-date') return prompt(); }
  return false;
}

module.exports = { start, check, state, evaluate, compare, prompt, runUpdate, sourceDir, mode, on: (...a) => events.on(...a) };
