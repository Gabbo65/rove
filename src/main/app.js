// Boot: storage → settings → sessions/IPC/menu → data import → phone remote → first window.
const { app, session } = require('electron');
const path = require('path');
const protocolMod = require('./protocol');

const rename = require('./rename');

// Data folder: <app data>/rove (tests and --user-data-dir pick their own). The first start after the
// rename from "Personal Browser" copies the old folder over; saved passwords are re-locked once it's open.
const TEST = !!process.env.PB_TEST;
let started = false; // the first browser window exists
const customDir = (TEST && !process.env.PB_NEW_DATA_DIR) || app.commandLine.hasSwitch('user-data-dir');
const dataDir = customDir ? app.getPath('userData') : rename.folders().newDir;
if (!customDir) {
  try { rename.copyIfNeeded(dataDir, rename.folders().oldDir); } catch (err) { console.error('Moving data from Personal Browser failed:', err); }
}
app.setName('Rove');
app.setPath('userData', dataDir);

protocolMod.registerScheme(); // must happen before 'ready'

if (!TEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  boot();
}

function boot() {
  const db = require('./db');
  const settings = require('./settings');
  const urls = require('./urls');
  const favorites = require('./favorites');
  const downloads = require('./downloads');
  const permissions = require('./permissions');
  const hub = require('./windows');
  const { Tab } = require('./tab');
  const ipc = require('./ipc');
  const menu = require('./menu');
  const remote = require('./remote');
  const migrate = require('./migrate');
  const updates = require('./updates');

  // ---------- shared actions (menu, phone, UI all use these) ----------
  Object.assign(hub, {
    findNext(dir) {
      const w = hub.current();
      if (!w) return;
      if (!w.findOpen) return w.openFind();
      w.sendHud({ findStep: dir });
    },
    // Pinned tabs of the most recent normal window are remembered for next launch.
    savePinned(win = hub.current()) {
      if (!win || win.private) return;
      const list = win.tabs.filter((t) => t.pinned && !urls.isNewTab(t.url))
        .map((t) => ({ url: t.errorUrl || t.url, title: t.title, favicon: t.favicon }));
      db.kv.set('pinnedTabs', list);
    },
    toggleFavoritesBar() { settings.set({ showFavoritesBar: !settings.get('showFavoritesBar') }); },
    openInternal(page, win = hub.current()) {
      const url = `pb://${page}/`;
      if (!win) return hub.create({ url });
      const existing = win.tabs.find((t) => urls.internalPage(t.url) === page);
      if (existing) win.activate(existing); else win.newTab(url);
    },
    cycleTab(dir) {
      const w = hub.current();
      if (!w?.tabs.length) return;
      const i = w.tabs.indexOf(w.active);
      w.activate(w.tabs[(i + dir + w.tabs.length) % w.tabs.length]);
    },
    selectTab(index) {
      const w = hub.current();
      if (!w?.tabs.length) return;
      w.activate(index === -1 ? w.tabs[w.tabs.length - 1] : w.tabs[index]);
    },
    // Returns the favorite plus added: true when it was just created.
    addFavoriteFromTab(win, tab) {
      if (!tab || urls.isInternal(tab.url) || !/^https?:|^file:/i.test(tab.url)) return null;
      const existing = favorites.findByUrl(tab.url);
      if (existing) return { ...existing, added: false };
      return { ...favorites.add({ url: tab.url, title: tab.title || '', favicon: tab.favicon }), added: true };
    },
    // Phone ☆: add (and let the Mac show the name popup) or remove the current page.
    toggleFavorite(win) {
      const tab = win?.active;
      if (!tab) return;
      const existing = favorites.findByUrl(tab.url);
      if (existing) return favorites.remove(existing.id);
      const fav = hub.addFavoriteFromTab(win, tab);
      if (fav) win.sendUI('command', { name: 'edit-favorite', id: fav.id, added: fav.added });
    },
  });

  app.whenReady().then(async () => {
    db.open(path.join(app.getPath('userData'), 'browser.db'));
    const moved = await rename.rekeyIfPending(db.get(), app.getPath('userData')).catch((err) => ({ lost: -1, error: String(err) }));
    if (moved?.lost) {
      require('electron').dialog.showMessageBox({ type: 'warning', message: 'Saved passwords weren’t moved to Rove',
        detail: `Rove couldn’t unlock the passwords saved in Personal Browser (${moved.error || 'access denied'}). `
          + 'Everything else was moved. Your old passwords are still in Personal Browser, untouched.' });
    }
    settings.load();
    require('electron').nativeTheme.themeSource = settings.get('theme');
    require('./passwords').on('change', () => hub.toPages('settings', 'passwords-changed'));
    downloads.load();
    permissions.setTabCheck((wc) => !!Tab.fromWebContents(wc));
    protocolMod.handleSession(session.defaultSession);
    ipc.register(hub);
    require('./autofill').register(hub);
    menu.build(hub);
    try { await migrate.run(); } catch (err) { console.error('Import of old data failed:', err); }
    hub.setRemote(remote);
    // The phone remote is optional: if it can't start, the browser still opens and says why.
    let remoteError = null;
    try { await remote.start(hub); } catch (err) { remoteError = err; console.error('Phone remote failed to start:', err); }
    const first = hub.create({ pinned: db.kv.get('pinnedTabs', []) });
    started = true;
    if (remoteError) {
      const why = /openssl|ENOENT/i.test(String(remoteError.message || remoteError)) ? 'a tool it needs (openssl) isn’t on this computer' : String(remoteError.message || remoteError);
      setTimeout(() => first?.showToast?.(`The phone remote couldn’t start: ${why}. Everything else works.`, 15000), 1500);
    }
    updates.on('change', (s) => { hub.broadcastUI('update', s); hub.toPages('settings', 'update', s); });
    hub.onUiReady = (win) => win.sendUI('update', updates.state());
    updates.start();
    app.emit('pb-ready', hub);
    // PB_SMOKE: CI start-up check of the real app (not test mode) — report and exit once the window is up.
    if (process.env.PB_SMOKE) {
      setTimeout(() => {
        const ok = hub.all().length > 0 && hub.all()[0].base.isVisible();
        console.log(ok ? 'SMOKE OK: window open' : 'SMOKE FAIL: no visible window');
        app.exit(ok ? 0 : 1);
      }, 4000);
    }
  }).catch((err) => {
    // Never fail silently (a hidden app with no window): say what went wrong.
    console.error('Startup failed:', err);
    if (TEST) return;
    if (process.env.PB_SMOKE) { console.log('SMOKE FAIL: startup error'); app.exit(1); return; }
    require('electron').dialog.showErrorBox('Rove couldn’t start', String(err?.stack || err));
    app.exit(1);
  });

  app.on('second-instance', () => {
    const w = hub.current();
    if (w) { if (w.base.isMinimized()) w.base.restore(); w.base.focus(); } else hub.create();
  });
  app.on('activate', () => { if (!hub.all().length && app.isReady()) hub.create(); });
  // Windows / Linux: closing the last window quits (Mac apps stay open). Only once the browser is up — hidden
  // helper windows during startup (e.g. the one-time import) close before the first real window exists.
  // Tests open and close windows freely.
  app.on('window-all-closed', () => { if (process.platform !== 'darwin' && started && !TEST) app.quit(); });
  app.on('will-quit', () => db.close());
}
