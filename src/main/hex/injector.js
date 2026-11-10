// Hex Injector: puts the user's scripts in the wheel (Injector → JavaScript / CSS / HTML → scripts) and runs them.
const scripts = require('./scripts');
const inject = require('./inject');

const GROUP_EMPTY = 'No manual scripts here yet — open Scripts… to write one.';

// ---------- the Injector window: an always-on-top script editor ----------
let editor = null;
function openEditor() {
  if (editor && !editor.isDestroyed()) { editor.show(); editor.focus(); return editor; }
  const { BrowserWindow } = require('electron');
  const { lockUiView, UI_PREFS } = require('../window');
  editor = new BrowserWindow({ width: 900, height: 600, minWidth: 620, minHeight: 380, title: 'Hex Injector',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', backgroundColor: '#110e1b',
    alwaysOnTop: true, show: false, webPreferences: UI_PREFS });
  editor.setAlwaysOnTop(true, 'floating');
  const home = 'pb://hex/scripts.html';
  lockUiView(editor.webContents, home);
  editor.loadURL(home);
  editor.webContents.once('did-finish-load', () => { if (editor && !editor.isDestroyed()) editor.show(); });
  editor.on('closed', () => { editor = null; });
  return editor;
}
const isEditor = (wc) => !!editor && !editor.isDestroyed() && wc === editor.webContents;
scripts.on('change', () => { if (editor && !editor.isDestroyed()) editor.webContents.send('hexs:changed'); });

function setup(core, hub) {
  const { ipcMain } = require('electron');
  const only = (channel, fn) => ipcMain.handle(channel, async (e, ...args) => {
    if (!isEditor(e.sender)) throw new Error('not allowed');
    try { return await fn(...args); } catch (err) { return { error: String(err && err.message || err) }; }
  });
  const target = () => { const w = hub.current(); const t = w?.active; return t && !t.asleep ? { win: w, tab: t } : null; };
  only('hexs:list', () => ({ scripts: scripts.list(), langs: scripts.LANGS, runModes: scripts.RUN_MODES }));
  only('hexs:save', (s) => ({ script: scripts.save(s || {}) }));
  only('hexs:delete', (id) => { scripts.remove(id); return {}; });
  only('hexs:dup', (id) => ({ script: scripts.duplicate(id) }));
  only('hexs:fav', (id, on) => ({ script: scripts.setFavorite(id, !!on) }));
  only('hexs:pin', (on) => { editor.setAlwaysOnTop(!!on, 'floating'); return { pinned: editor.isAlwaysOnTop() }; });
  only('hexs:target', () => {
    const t = target();
    return t ? { title: t.tab.title || t.tab.url, url: t.tab.url, web: inject.isWebPage(t.tab.url) } : { title: '', url: '', web: false };
  });
  only('hexs:run', async (id) => {
    const s = scripts.byId(id);
    if (!s) throw new Error('Save the script first');
    const t = target();
    if (!t) throw new Error('No tab to run on');
    const r = await inject.run(s, t.tab, { allowedOn: scripts.allowedOn });
    return { message: r.message };
  });

  // Automatic scripts: run by themselves when a tab finishes loading one of their sites (errors go to the log only).
  const { app } = require('electron');
  app.on('web-contents-created', (_e, wc) => {
    wc.on('dom-ready', () => {
      const url = wc.getURL();
      if (!inject.isWebPage(url) || !hub.fromTabWebContents(wc)) return; // tabs only, never Rove's own views
      for (const s of scripts.autoFor(url)) {
        inject.run(s, { wc }, { allowedOn: scripts.allowedOn, auto: true })
          .catch((err) => console.warn(`[hex] auto script "${s.name}": ${err.message}`));
      }
    });
  });

  core.provide({
    family: 'injector',
    prefix: 'script.',
    nodes() {
      const all = scripts.list();
      const groups = Object.entries(scripts.LANGS).map(([lang, name]) => ({
        id: `script.lang.${lang}`, kind: 'group', icon: `lang-${lang}`, name, description: `Your ${name} scripts`, empty: GROUP_EMPTY,
        items: all.filter((s) => s.lang === lang && s.run === 'manual').map((s) => ({
          id: `script.run.${s.id}`, kind: 'run', icon: `lang-${lang}`, name: (s.favorite ? '★ ' : '') + s.name,
          description: s.description || s.code.split('\n').find((l) => l.trim())?.trim().slice(0, 80) || '(empty)',
        })),
      }));
      return [...groups, { id: 'script.open', kind: 'run', icon: 'edit', name: 'Scripts…', description: 'Write and manage your scripts' }];
    },
    async run({ win, tab }, id) {
      if (id === 'script.open') { openEditor(); return {}; }
      const m = /^script\.run\.(\d+)$/.exec(id);
      const s = m && scripts.byId(m[1]);
      if (!s) throw new Error('That script is gone');
      const r = await inject.run(s, tab, { allowedOn: scripts.allowedOn });
      win.showToast(`${s.name}: ${r.message}`, 4000);
      return r;
    },
  });
}

module.exports = { setup, openEditor, editorWindow: () => editor };
