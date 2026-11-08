// Engine updates. The browser is only as safe as its Chromium engine, which ships inside Electron.
// We check the newest Electron release (npm registry) once a day, tell the UI, and "Update now" runs
// scripts/update-engine.sh in Terminal: upgrade Electron → run all tests → rebuild + reinstall only if they pass.
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

function state() {
  const saved = db.kv.get('updates', null);
  const current = process.versions.electron;
  const latest = saved?.latest || null;
  return { current, chromium: process.versions.chrome, latest, status: evaluate(current, latest), checkedAt: saved?.checkedAt || 0, error: saved?.error || null };
}

async function check() {
  const url = process.env.PB_UPDATE_URL || 'https://registry.npmjs.org/electron/latest';
  try {
    const res = await net.fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { version } = await res.json();
    if (!/^\d+\.\d+\.\d+/.test(version || '')) throw new Error('bad version');
    db.kv.set('updates', { latest: version, checkedAt: Date.now(), error: null });
  } catch (err) {
    const prev = db.kv.get('updates', {}) || {};
    db.kv.set('updates', { ...prev, checkedAt: Date.now(), error: String(err.message || err) });
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

module.exports = { start, check, state, evaluate, compare, prompt, runUpdate, sourceDir, on: (...a) => events.on(...a) };
