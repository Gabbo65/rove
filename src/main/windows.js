// All windows + the glue between them and everything global (favorites, downloads, phone remote, settings).
const { BaseWindow, nativeTheme, webContents } = require('electron');
const { Win } = require('./window');
const { Tab } = require('./tab');
const urls = require('./urls');
const settings = require('./settings');
const favorites = require('./favorites');
const downloads = require('./downloads');
const history = require('./history');
const protocolMod = require('./protocol');
const permissions = require('./permissions');

const windows = new Set();
let lastFocused = null;
let remote = null; // set by app.js (src/main/remote.js) — kept loosely coupled
let readyResolvers = [];

const hub = {
  // ---------- windows ----------
  create({ isPrivate = false, url, tabs, pinned } = {}) {
    const win = new Win(hub, { isPrivate });
    // First tab of a new window: your start page (Settings → General), unless told otherwise.
    if (!url && !isPrivate && settings.get('startPage') === 'url' && settings.get('startUrl')) url = settings.get('startUrl');
    windows.add(win);
    if (!lastFocused) lastFocused = win;
    if (Array.isArray(tabs) && tabs.length) {
      for (const t of tabs) win.newTab(t.url, { pinned: !!t.pinned, background: true, asleep: !!t.asleep, title: t.title, favicon: t.favicon });
      const firstNormal = win.tabs.find((t) => !t.pinned) || win.tabs[0];
      win.activate(firstNormal);
    } else {
      win.newTab(url || urls.NEWTAB);
    }
    // Pinned tabs from last time: at the front, asleep until you click them (no memory used at startup).
    if (Array.isArray(pinned) && pinned.length) {
      const first = win.active;
      pinned.forEach((p, i) => {
        const t = win.newTab(p.url, { pinned: true, background: true, asleep: true, title: p.title, favicon: p.favicon, index: i });
        t.savedUrl = t.url;
      });
      win.activate(first);
    }
    return win;
  },
  all() { return [...windows]; },
  // The window menu shortcuts and the phone act on: the focused one, else the last focused.
  current() {
    const focused = BaseWindow.getFocusedWindow();
    for (const w of windows) if (w.base === focused) return w;
    if (lastFocused && windows.has(lastFocused)) return lastFocused;
    return windows.values().next().value || null;
  },
  fromChrome(wc) {
    // The view must be one of a window's UI views AND still be showing our own UI page.
    if (!wc || wc.isDestroyed() || !/^pb:\/\/(chrome|hud)\//i.test(wc.getURL())) return null;
    for (const w of windows) if (!w.destroyed && (w.chrome.webContents === wc || w.hud.webContents === wc)) return w;
    return null;
  },
  fromTabWebContents(wc) { return Tab.fromWebContents(wc); },
  whenReady() { return windows.size && [...windows].some((w) => w.uiReady) ? Promise.resolve() : new Promise((r) => readyResolvers.push(r)); },

  // ---------- callbacks from windows ----------
  prepareSession(ses, { isPrivate }) {
    protocolMod.handleSession(ses);
    permissions.attach(ses);
    downloads.attachSession(ses, { isPrivate });
    hub.onSessionPrepared?.(ses, { isPrivate });
  },
  onWindowReady(win) {
    win.sendUI('favorites', favorites.list());
    win.sendUI('downloads', { list: downloads.list(), open: false });
    win.sendUI('settings', settings.all());
    win.sendUI('remote-status', hub.remoteStatus());
    hub.onUiReady?.(win);
    const r = readyResolvers; readyResolvers = [];
    r.forEach((fn) => fn());
  },
  onWindowFocus(win) {
    lastFocused = win;
    remote?.targetChanged();
  },
  onWindowState(win) {
    if (win === hub.current()) remote?.tabsChanged();
  },
  onActiveTab(win) {
    if (win === hub.current()) remote?.targetChanged();
  },
  onActiveTabChanged(win) {
    if (win === hub.current()) remote?.stateChanged();
  },
  onContentResize() {},
  onPinnedChanged() { hub.savePinned?.(); },
  onWindowClosing(win) { hub.savePinned?.(win); },
  onWindowClosed(win) {
    windows.delete(win);
    if (lastFocused === win) lastFocused = [...windows].pop() || null;
    if (win.private) {
      // Private window gone: wipe everything its session stored.
      const ses = win.session;
      Promise.all([ses.clearStorageData(), ses.clearCache(), ses.clearAuthCache(), ses.clearHostResolverCache()]).catch(() => {});
      downloads.forgetPrivate();
    }
    remote?.targetChanged();
  },

  // ---------- phone remote ----------
  setRemote(r) { remote = r; },
  // Show the QR by itself? Only with the phone remote on and "Show the QR code…" on.
  qrAuto() { return settings.get('remoteEnabled') && settings.get('remoteQrAuto'); },
  remoteStatus() { return remote ? remote.status() : { clients: 0, url: '', qr: '' }; },
  onRemoteStatus(status, { clientsChanged } = {}) {
    for (const w of windows) {
      // QR shows while no phone is connected (if that's on), hides when one joins (the toolbar button can still toggle it).
      if (clientsChanged) w.qrVisible = status.clients === 0 && hub.qrAuto();
      w.sendUI('remote-status', status);
      w.sendHud();
    }
  },

  // ---------- broadcast helpers ----------
  broadcastUI(channel, data) { for (const w of windows) w.sendUI(channel, data); },
  // Event to every open built-in page of one kind (e.g. all pb://settings tabs).
  toPages(page, name, data) {
    for (const w of windows) for (const t of w.tabs) if (urls.internalPage(t.url) === page && t.wc) t.wc.send('pb:event', name, data);
  },
};

// Global data changes → every window (and the phone).
favorites.on('change', (list) => {
  hub.broadcastUI('favorites', list);
  for (const w of windows) for (const t of w.tabs) if (urls.isNewTab(t.url) && t.wc) t.wc.send('pb:event', 'favorites', list);
  remote?.favoritesChanged();
});
downloads.on('change', (payload) => {
  hub.broadcastUI('downloads', payload);
  for (const w of windows) w.base.setProgressBar(payload.progress);
});
history.on('change', () => {
  for (const w of windows) for (const t of w.tabs) if (urls.internalPage(t.url) === 'history' && t.wc) t.wc.send('pb:event', 'history-changed');
});
settings.on('change', (changed, all) => {
  hub.broadcastUI('settings', all);
  hub.toPages('settings', 'settings', all);
  if ('theme' in changed) nativeTheme.themeSource = all.theme;
  if (settings.LOOK_KEYS.some((k) => k in changed)) hub.lookChanged();
  if ('hexTrigger' in changed) require('./menu').build(hub); // new Hex Trigger shortcut
  if (settings.NEWTAB_KEYS.some((k) => k in changed)) {
    const look = Object.fromEntries(settings.NEWTAB_KEYS.map((k) => [k, all[k]]));
    hub.toPages('newtab', 'look', look);
  }
  if ('remoteQrAuto' in changed || 'remoteEnabled' in changed) {
    const show = hub.qrAuto() && hub.remoteStatus().clients === 0;
    for (const w of windows) if (w.qrVisible !== show) w.toggleQR(show);
  }
});
nativeTheme.on('updated', () => hub.lookChanged());
// Appearance changed: every open Rove page reloads its look.css; windows recolor their native parts.
hub.lookChanged = () => {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed() && /^pb:\/\//.test(wc.getURL())) wc.send('pb:look');
  }
  for (const w of windows) {
    w.applyLook();
    for (const t of w.tabs) t.applyBackground();
  }
};

// Sleeping tabs: every minute, unload tabs nobody looked at for a while (never the visible one or one playing sound).
setInterval(() => hub.sleepIdleTabs(), 60_000).unref?.();
hub.sleepIdleTabs = (now = Date.now()) => {
  if (!settings.get('sleepingTabs')) return 0;
  const limit = settings.get('sleepAfterMinutes') * 60_000;
  let n = 0;
  for (const w of windows) {
    for (const t of w.tabs) {
      if (t === w.active || t.asleep || !t.view || t.audible) continue;
      if (now - t.lastActive >= limit && t.sleep()) n++;
    }
  }
  return n;
};

module.exports = hub;
