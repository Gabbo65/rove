// One browser tab = one WebContentsView (its own page process), managed here in the main process.
// A tab can be asleep: no view, no memory — just its address, title, icon and back/forward list.
const { WebContentsView, Menu, clipboard, nativeTheme } = require('electron');
const { PRELOAD } = require('./paths');
const urls = require('./urls');
const history = require('./history');
const favorites = require('./favorites');

const byWebContents = new Map(); // webContents.id -> Tab
let seq = 0;

const webOrigin = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.origin : null; } catch { return null; } };
const iconUrl = (u) => typeof u === 'string' && u.length < 100_000 && /^(https?:\/\/|data:image\/)/i.test(u);
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

// Does the site have a real /favicon.ico? (Asked with the tab's own session, like the page itself would.)
async function iconExists(ses, url) {
  try {
    const res = await ses.fetch(url, { signal: AbortSignal.timeout(4000) });
    res.body?.cancel().catch(() => {});
    return res.ok && /^image\//i.test(res.headers.get('content-type') || '');
  } catch { return false; }
}

class Tab {
  constructor(win, { url = urls.NEWTAB, pinned = false, asleep = false, title = '', favicon = null, navState = null } = {}) {
    this.id = ++seq;
    this.win = win;
    this.url = url;
    this.title = title;
    this.favicon = favicon;
    this.pinned = pinned;
    this.loading = false;
    this.audible = false;
    this.asleep = false;
    this.errorUrl = null;      // the address that failed, while pb://error is showing
    this.typedNext = false;    // next navigation was typed in the address bar (history ranking)
    this.lastActive = Date.now();
    this.crashes = [];
    this.navState = navState;
    this.view = null;
    if (asleep) this.asleep = true;
    else this.createView();
  }

  static fromWebContents(wc) { return wc ? byWebContents.get(wc.id) || null : null; }

  get wc() { return this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null; }

  // ---------- view lifecycle ----------
  createView() {
    const view = new WebContentsView({
      webPreferences: {
        session: this.win.session,
        preload: PRELOAD.tab,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: true,
        nodeIntegrationInSubFrames: true, // runs our (sandboxed, Node-free) preload in iframes too: login iframes get autofill + the passkey fix
        spellcheck: true,
        safeDialogs: true,
      },
    });
    this.view = view;
    const wc = view.webContents;
    byWebContents.set(wc.id, this);
    this.applyBackground();
    this.wire(wc);
    const nav = this.navState;
    this.navState = null;
    if (nav?.entries?.length) {
      // An "aborted" result here is normal; only load the address if nothing got restored.
      wc.navigationHistory.restore({ index: nav.index, entries: nav.entries }).catch(() => {
        if (!wc.isDestroyed() && wc.navigationHistory.length() === 0) wc.loadURL(this.url).catch(() => {});
      });
    } else {
      wc.loadURL(this.url).catch(() => {});
    }
  }

  destroyView() {
    const view = this.view;
    if (!view) return;
    this.view = null;
    this.win.detachView(view);
    const wc = view.webContents;
    byWebContents.delete(wc.id);
    if (!wc.isDestroyed()) wc.close();
  }

  // Free the page's memory; keep everything needed to bring it back.
  sleep() {
    const wc = this.wc;
    if (!wc || this.asleep || this === this.win.active || this.audible) return false;
    const h = wc.navigationHistory;
    this.navState = { index: h.getActiveIndex(), entries: h.getAllEntries().map(({ url, title }) => ({ url, title })) };
    this.loading = false;
    this.destroyView();
    this.asleep = true;
    this.changed();
    return true;
  }

  wake() {
    if (!this.asleep) return;
    this.asleep = false;
    this.createView();
    this.changed();
  }

  applyBackground() {
    if (!this.view) return;
    const internal = urls.isInternal(this.url);
    const look = require('./look');
    const g = look.glass();
    // Docked Glass + Pages Glass: Rove's own pages let the window's glass show through
    const page = this.win.private ? '#231a33' : g.pagesNative ? '#00000000' : look.palette(nativeTheme.shouldUseDarkColors).page;
    this.view.setBackgroundColor(internal ? page : '#ffffff');
  }

  // ---------- events ----------
  wire(wc) {
    const changed = () => this.changed();

    wc.on('did-start-loading', () => { this.loading = true; changed(); });
    // A freshly loaded New Tab page grabs the keyboard focus: hand it back to the address bar.
    wc.on('did-finish-load', () => {
      if (urls.isNewTab(this.url) && this.win.active === this && this.view?.webContents.isFocused()) this.win.focusActive();
    });
    wc.on('did-stop-loading', () => { this.loading = false; changed(); this.findFavicon(); });

    wc.on('did-navigate', (_e, url) => {
      const wasError = urls.internalPage(this.url) === 'error';
      const prevUrl = this.url;
      this.url = url;
      this.iconFor = null;
      if (urls.internalPage(url) !== 'error') this.errorUrl = null;
      // Same site: keep its icon until the new page says otherwise (no flash, and pages restored from
      // the back/forward cache or a prerender don't announce their icon again).
      const sameSite = webOrigin(prevUrl) && webOrigin(prevUrl) === webOrigin(url);
      if ((!wasError || urls.internalPage(url) !== 'error') && !sameSite) this.favicon = null;
      this.applyBackground();
      this.record(url);
      changed();
      clearTimeout(this.iconTimer);
      this.iconTimer = setTimeout(() => this.findFavicon(), 1500);
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.url = url;
      this.record(url);
      changed();
    });
    wc.on('page-title-updated', (_e, title) => {
      this.title = title;
      if (!this.win.private) history.updatePage(this.url, { title });
      changed();
    });
    wc.on('page-favicon-updated', (_e, icons) => {
      const icon = (icons || []).find((u) => u && u !== 'data:,' && !/^data:,?$/.test(u));
      if (icon) this.iconFor = this.url;
      this.setFavicon(icon || null);
      if (!icon) this.findFavicon();
    });

    // Network errors → our "Can't reach this page" page (address bar keeps the failed address).
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3 /* aborted */ || code === 0) return;
      if (/^pb:/i.test(failedUrl)) return;
      this.errorUrl = failedUrl;
      const q = new URLSearchParams({ code: String(code), desc: String(desc || ''), url: failedUrl });
      wc.loadURL(`pb://error/?${q}`).catch(() => {});
    });

    // Page process crashed: reload (a fresh process). Twice in a minute → show the error page instead.
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return;
      const now = Date.now();
      this.crashes = this.crashes.filter((t) => now - t < 60_000).concat(now);
      this.loading = false;
      changed();
      setTimeout(() => {
        if (!this.wc) return;
        if (this.crashes.length <= 1) this.wc.reload();
        else {
          this.errorUrl = urls.isInternal(this.url) ? null : this.url;
          const q = new URLSearchParams({ code: 'crashed', desc: details.reason, url: this.errorUrl || '' });
          this.wc.loadURL(`pb://error/?${q}`).catch(() => {});
        }
      }, 250);
    });

    wc.on('audio-state-changed', (e) => { this.audible = !!e.audible; changed(); });
    wc.on('found-in-page', (_e, result) => this.win.onFindResult(this, result));
    wc.on('context-menu', (_e, params) => this.contextMenu(params));
    wc.on('enter-html-full-screen', () => this.win.setPageFullscreen(this, true));
    wc.on('leave-html-full-screen', () => this.win.setPageFullscreen(this, false));
    wc.on('focus', () => this.win.onTabFocus(this));

    // Web pages may not open our internal pages (pb://…) — only the browser itself can.
    const guard = (e) => {
      const target = e.url || '';
      if (/^pb:/i.test(target) && (!urls.isInternal(target) || !urls.isInternal(wc.getURL()))) e.preventDefault();
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);

    // Web Bluetooth: Electron's default is to silently pick the FIRST nearby device for the page.
    // We have no device chooser yet, so refuse instead.
    wc.on('select-bluetooth-device', (e, _devices, callback) => { e.preventDefault(); callback(''); });

    // window.open / target=_blank: real popups (OAuth logins etc.) get a small window; links get a tab.
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (/^pb:/i.test(url)) return { action: 'deny' };
      if (disposition === 'new-window') {
        return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } } };
      }
      this.win.newTab(url, { background: disposition === 'background-tab', opener: this });
      return { action: 'deny' };
    });
  }

  record(url) {
    if (this.win.private || !/^https?:/i.test(url)) { this.typedNext = false; return; }
    history.recordVisit(url, this.wc?.getTitle() === url ? '' : this.wc?.getTitle() || '', { typed: this.typedNext });
    this.typedNext = false;
  }

  changed() { this.win.onTabChanged(this); }

  // ---------- actions ----------
  load(url, { typed = false } = {}) {
    if (!url) return;
    this.url = url;
    this.typedNext = typed;
    this.errorUrl = null;
    if (this.asleep) { this.navState = null; this.wake(); return; }
    this.wc?.loadURL(url).catch(() => {}); // aborted loads (you clicked elsewhere) are normal
  }

  canGoBack() {
    if (this.wc) return this.wc.navigationHistory.canGoBack();
    return !!this.navState && this.navState.index > 0;
  }
  canGoForward() {
    if (this.wc) return this.wc.navigationHistory.canGoForward();
    return !!this.navState && this.navState.index < this.navState.entries.length - 1;
  }
  back() { if (this.asleep) this.wake(); if (this.wc?.navigationHistory.canGoBack()) this.wc.navigationHistory.goBack(); }
  forward() { if (this.asleep) this.wake(); if (this.wc?.navigationHistory.canGoForward()) this.wc.navigationHistory.goForward(); }
  reload(hard = false) {
    if (this.asleep) return this.wake();
    if (this.errorUrl) return this.load(this.errorUrl);
    if (hard) this.wc?.reloadIgnoringCache(); else this.wc?.reload();
  }
  stop() { this.wc?.stop(); }
  focus() { this.wc?.focus(); }

  setFavicon(icon) {
    this.favicon = icon;
    if (!this.win.private) {
      history.updatePage(this.url, { favicon: icon });
      favorites.noteFavicon(this.url, icon);
    }
    this.changed();
  }

  // Chromium doesn't always tell us the icon (pages from the back/forward cache or a prerender, sites
  // without an icon tag). Then look ourselves: the page's icon tags, else the site's /favicon.ico.
  async findFavicon() {
    const wc = this.wc, url = this.url, origin = webOrigin(url);
    if (!wc || !origin || this.iconFor === url || this.iconLooking === url) return;
    this.iconLooking = url;
    let icon = null;
    try {
      const list = await withTimeout(wc.executeJavaScript(
        `[...document.querySelectorAll('link[rel~="icon" i]')].map((l) => l.href)`), 2000);
      icon = (Array.isArray(list) ? list : []).find(iconUrl) || null;
    } catch { /* page busy or gone */ }
    if (!icon && !wc.isDestroyed() && await iconExists(wc.session, `${origin}/favicon.ico`)) icon = `${origin}/favicon.ico`;
    if (this.iconLooking === url) this.iconLooking = null;
    if (wc.isDestroyed() || this.wc !== wc || this.url !== url || this.iconFor === url) return;
    this.iconFor = url;
    if (icon && icon !== this.favicon) this.setFavicon(icon);
  }

  // ---------- what the UI / phone see ----------
  state() {
    const page = urls.internalPage(this.url);
    const url = page === 'error' ? this.errorUrl || '' : urls.displayUrl(this.url);
    let title = this.title;
    if (page === 'error') title = urls.INTERNAL_TITLES.error;
    else if (page) title = urls.INTERNAL_TITLES[page];
    else if (!title) title = url;
    return {
      id: this.id,
      title,
      url,
      favicon: page ? null : this.favicon,
      internal: page,
      loading: this.loading,
      pinned: this.pinned,
      asleep: this.asleep,
      audible: this.audible,
      canBack: this.canGoBack(),
      canForward: this.canGoForward(),
    };
  }

  contextMenu(p) {
    const wc = this.wc;
    if (!wc) return;
    const items = [];
    const openTab = (url) => this.win.newTab(url, { background: true, opener: this });
    // A web page's link must not become a way into our internal pages (same rule as clicking it).
    const openable = (url) => !!url && !/^(javascript|pb):/i.test(url);
    if (p.linkURL && openable(p.linkURL)) {
      items.push(
        { label: 'Open Link in New Tab', click: () => openTab(p.linkURL) },
        { label: 'Copy Link', click: () => clipboard.writeText(p.linkURL) },
        { type: 'separator' });
    }
    if (p.mediaType === 'image' && openable(p.srcURL)) {
      items.push(
        { label: 'Open Image in New Tab', click: () => openTab(p.srcURL) },
        { label: 'Copy Image', click: () => wc.copyImageAt(p.x, p.y) },
        { label: 'Save Image As…', click: () => wc.downloadURL(p.srcURL) },
        { type: 'separator' });
    }
    if (p.isEditable) {
      items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' });
    } else if (p.selectionText) {
      const q = p.selectionText.trim().replace(/\s+/g, ' ').slice(0, 200);
      const short = q.length > 30 ? q.slice(0, 30) + '…' : q;
      items.push({ role: 'copy' },
        { label: `Search ${urls.engine().name} for “${short}”`, click: () => this.win.newTab(urls.searchUrl(q), { opener: this }) },
        { type: 'separator' });
    }
    items.push(
      { label: 'Back', enabled: this.canGoBack(), click: () => this.back() },
      { label: 'Forward', enabled: this.canGoForward(), click: () => this.forward() },
      { label: 'Reload', click: () => this.reload() },
      { type: 'separator' },
      { label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup({ window: this.win.base });
  }
}

module.exports = { Tab };
