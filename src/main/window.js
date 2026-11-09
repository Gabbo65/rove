// A browser window: the UI ("chrome") + its tabs, each tab a WebContentsView.
//
// Views stacked in the window, bottom → top:
//   chrome (toolbar UI, full window, transparent where the page goes)
//   active tab's page (fills the content area the UI reports)
//   hud    (find bar + phone QR, only as big as what it shows, top-right of the page)
//   cursor (phone trackpad cursor, 24×24)
// While a popup is open (downloads, history, address suggestions…) the chrome moves to the TOP so its
// popups draw over the page; the page stays visible through the transparent area. Clicking there closes the popup.
const { BaseWindow, WebContentsView, session, nativeTheme } = require('electron');
const path = require('path');
const { PRELOAD, ROOT } = require('./paths');
const { Tab } = require('./tab');
const urls = require('./urls');
const closed = require('./closed');

let seq = 0;

const UI_PREFS = { preload: PRELOAD.chrome, contextIsolation: true, sandbox: true, nodeIntegration: false };

// The UI views (toolbar, hud, cursor) only ever show our own pb:// pages. They never navigate, never open
// windows — otherwise e.g. a link dropped on the tab strip would load a web page into the UI, next to the
// browser's own controls. If one is somehow pulled off its page anyway, it's put straight back.
function lockUiView(wc, home) {
  const block = (e) => e.preventDefault();
  wc.on('will-navigate', block);
  wc.on('will-redirect', block);
  wc.on('will-frame-navigate', (e) => { if (!/^pb:\/\/(chrome|hud)\//i.test(e.url || '')) e.preventDefault(); });
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-attach-webview', block);
  wc.on('did-navigate', (_e, url) => { if (!url.startsWith(home.split('?')[0])) wc.loadURL(home).catch(() => {}); });
}

// Windows / Linux: no Mac "traffic lights" — the system draws minimize / maximize / close at the top right,
// over our tab strip, in the strip's colour (updated when the theme changes).
const IS_MAC = process.platform === 'darwin';
function overlayColors(isPrivate) {
  if (isPrivate) return { color: '#1a1326', symbolColor: '#e8e3f3', height: 40 };
  return nativeTheme.shouldUseDarkColors ? { color: '#1f1f1f', symbolColor: '#e6e6e6', height: 40 } : { color: '#e9e9ec', symbolColor: '#1f1f1f', height: 40 };
}
function frameOptions(isPrivate) {
  if (IS_MAC) return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 13 } };
  return { titleBarStyle: 'hidden', titleBarOverlay: overlayColors(isPrivate), autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon: path.join(ROOT, 'build', 'icon.png') } : {}) };
}

function themeBackground(isPrivate) {
  if (isPrivate) return '#231a33';
  return nativeTheme.shouldUseDarkColors ? '#2c2c2c' : '#f7f7f8';
}

class Win {
  constructor(app, { isPrivate = false } = {}) {
    this.app = app;               // registry (src/main/windows.js)
    this.id = ++seq;
    this.private = isPrivate;
    this.session = isPrivate ? session.fromPartition(`pb-private-${this.id}`) : session.defaultSession; // no "persist:" = memory only
    this.closedTabs = isPrivate ? new closed.MemoryStack() : closed.shared;
    this.tabs = [];
    this.active = null;
    this.content = { x: 0, y: 112, width: 1280, height: 748 };
    this.overlay = false;
    this.hudSize = { width: 0, height: 0 };
    this.cursorOn = false;
    this.cursorTimer = null;
    this.fullscreenTab = null;
    this.qrVisible = true;
    this.findOpen = false;
    this.uiReady = false;
    this.destroyed = false;
    this.stateTimer = null;

    app.prepareSession(this.session, { isPrivate });

    this.base = new BaseWindow({
      width: 1280, height: 860, minWidth: 600, minHeight: 400,
      ...frameOptions(isPrivate),
      backgroundColor: themeBackground(isPrivate), show: false,
      title: isPrivate ? 'InPrivate' : 'Rove',
    });

    this.chrome = new WebContentsView({ webPreferences: UI_PREFS });
    this.chrome.setBackgroundColor('#00000000');
    this.hud = new WebContentsView({ webPreferences: UI_PREFS });
    this.hud.setBackgroundColor('#00000000');
    this.cursor = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    this.cursor.setBackgroundColor('#00000000');

    this.base.contentView.addChildView(this.chrome);
    const homes = [[this.chrome, `pb://chrome/index.html${isPrivate ? '?private=1' : ''}`],
      [this.hud, 'pb://hud/index.html'], [this.cursor, 'pb://hud/cursor.html']];
    for (const [view, home] of homes) { lockUiView(view.webContents, home); view.webContents.loadURL(home); }

    this.chrome.webContents.once('did-finish-load', () => {
      this.uiReady = true;
      this.sendState(true);
      this.app.onWindowReady(this);
      if (!this.base.isVisible()) this.base.show();
    });
    setTimeout(() => { if (!this.destroyed && !this.base.isVisible()) this.base.show(); }, 1500);
    this.hud.webContents.once('did-finish-load', () => this.sendHud());

    if (!IS_MAC) {
      this.base.setMenuBarVisibility?.(false); // shortcuts still work; menu items live in the ⋯ button
      const recolor = () => { if (!this.destroyed) try { this.base.setTitleBarOverlay(overlayColors(isPrivate)); } catch {} };
      nativeTheme.on('updated', recolor);
      this.base.once('closed', () => nativeTheme.removeListener('updated', recolor));
    }
    this.base.on('resize', () => this.layout());
    this.base.on('focus', () => this.app.onWindowFocus(this));
    this.base.on('close', () => this.onClose());
    this.base.on('closed', () => this.onClosed());
    this.base.on('enter-full-screen', () => this.sendUI('fullscreen', true));
    this.base.on('leave-full-screen', () => this.sendUI('fullscreen', false));

    this.layout();
  }

  // ---------- messaging ----------
  sendUI(channel, data) {
    const wc = this.chrome.webContents;
    if (!this.destroyed && !wc.isDestroyed()) wc.send(channel, data);
  }
  sendHud(extra) {
    const wc = this.hud.webContents;
    if (this.destroyed || wc.isDestroyed()) return;
    const remote = this.app.remoteStatus();
    wc.send('hud:state', {
      qr: { visible: this.qrVisible && !this.fullscreenTab, img: remote.qr, addr: remote.url, clients: remote.clients, offline: !!remote.offline },
      find: { open: this.findOpen && !this.fullscreenTab },
      toast: this.fullscreenTab ? null : this.toast || null,
      private: this.private,
      ...extra,
    });
  }

  // Tab list + active tab → UI (batched: many events in a row become one update).
  sendState(now = false) {
    if (this.destroyed) return;
    const send = () => {
      this.stateTimer = null;
      this.sendUI('state', {
        windowId: this.id,
        private: this.private,
        tabs: this.tabs.map((t) => ({ ...t.state(), active: t === this.active })),
        activeId: this.active?.id ?? null,
        closedCount: this.closedTabs.size,
      });
      this.app.onWindowState(this);
    };
    if (now) { clearTimeout(this.stateTimer); return send(); }
    if (!this.stateTimer) this.stateTimer = setTimeout(send, 16);
  }

  // ---------- layout ----------
  setContentRect(r) {
    const n = (v) => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
    this.content = { x: n(r.x), y: n(r.y), width: n(r.width), height: n(r.height) };
    this.layout();
    this.app.onContentResize(this);
  }

  layout() {
    if (this.destroyed) return;
    const [w, h] = this.base.getContentSize();
    this.chrome.setBounds({ x: 0, y: 0, width: w, height: h });
    const page = this.fullscreenTab ? { x: 0, y: 0, width: w, height: h } : this.content;
    if (this.active?.view) this.active.view.setBounds(page);
    const hw = Math.min(this.hudSize.width, page.width), hh = Math.min(this.hudSize.height, page.height);
    this.hud.setBounds({ x: page.x + page.width - hw, y: page.y, width: hw, height: hh });
  }

  // Put the views in the right order (and remove hidden tabs' views — hidden pages get throttled).
  stack() {
    if (this.destroyed) return;
    const cv = this.base.contentView;
    const order = [];
    const showHud = this.hudSize.width > 0 && this.hudSize.height > 0;
    if (!this.overlay) order.push(this.chrome);
    if (this.active?.view) order.push(this.active.view);
    if (showHud) order.push(this.hud);
    if (this.cursorOn) order.push(this.cursor);
    if (this.overlay) order.push(this.chrome);
    for (const child of [...cv.children]) if (!order.includes(child)) cv.removeChildView(child);
    const current = cv.children;
    const inOrder = current.length === order.length && current.every((v, i) => v === order[i]);
    if (!inOrder) for (const v of order) cv.addChildView(v);
    this.layout();
  }

  detachView(view) {
    if (this.destroyed) return;
    try { this.base.contentView.removeChildView(view); } catch {}
  }

  setOverlay(open) {
    open = !!open;
    if (this.overlay === open) return;
    this.overlay = open;
    this.stack();
    if (!open) this.focusActive();
  }

  setHudSize(size) {
    const w = Math.max(0, Math.min(800, Math.round(size?.width || 0)));
    const h = Math.max(0, Math.min(800, Math.round(size?.height || 0)));
    if (w === this.hudSize.width && h === this.hudSize.height) return;
    this.hudSize = { width: w, height: h };
    this.stack();
  }

  // A page asked for fullscreen (video): the page fills the whole window, and the window goes fullscreen.
  setPageFullscreen(tab, on) {
    if (on) {
      this.fullscreenTab = tab;
      if (!this.base.isFullScreen()) { this.wasFullScreen = false; this.base.setFullScreen(true); } else this.wasFullScreen = true;
    } else if (this.fullscreenTab === tab) {
      this.fullscreenTab = null;
      if (!this.wasFullScreen && this.base.isFullScreen()) this.base.setFullScreen(false);
    }
    this.sendUI('page-fullscreen', !!this.fullscreenTab);
    this.sendHud();
    this.stack();
  }

  // ---------- tabs ----------
  newTab(url, { background = false, index, opener, pinned = false, typed = false, asleep = false, title, favicon } = {}) {
    const tab = new Tab(this, { url: url || urls.NEWTAB, pinned, asleep, title, favicon });
    tab.typedNext = typed;
    let at;
    const pinnedCount = this.tabs.filter((t) => t.pinned).length;
    if (Number.isInteger(index)) at = index;
    else if (opener && this.tabs.includes(opener)) {
      // Open after the opener and after tabs it already opened (like Edge).
      at = this.tabs.indexOf(opener) + 1;
      while (at < this.tabs.length && this.tabs[at].openerId === opener.id) at++;
      tab.openerId = opener.id;
    } else at = this.tabs.length;
    at = pinned ? Math.min(at, pinnedCount) : Math.max(at, pinnedCount);
    this.tabs.splice(Math.min(at, this.tabs.length), 0, tab);
    if (!background || !this.active) this.activate(tab);
    else this.sendState();
    return tab;
  }

  tab(id) { return this.tabs.find((t) => t.id === Number(id)) || null; }

  activate(tab) {
    if (!tab || !this.tabs.includes(tab)) return;
    const prev = this.active;
    if (prev === tab) { this.focusActive(); return; }
    if (prev) prev.lastActive = Date.now();
    if (this.findOpen) this.closeFind(false);
    if (this.fullscreenTab && this.fullscreenTab !== tab) this.setPageFullscreen(this.fullscreenTab, false);
    this.active = tab;
    tab.lastActive = Date.now();
    if (tab.asleep) tab.wake();
    this.stack();
    this.focusActive();
    this.sendState();
    this.app.onActiveTab(this);
  }

  focusActive() {
    const tab = this.active;
    if (!tab || this.overlay) return;
    if (urls.isNewTab(tab.url)) { this.chrome.webContents.focus(); this.sendUI('command', { name: 'focus-url' }); }
    else tab.focus();
  }

  // One tab closed = one undoable action (⇧⌘T). Several at once = still one action.
  close(tab, { record = true } = {}) { this.closeMany([tab], { record }); }

  closeMany(list, { record = true } = {}) {
    list = list.filter((t) => this.tabs.includes(t));
    if (!list.length) return;
    if (record) this.recordClose(list);
    const activeIndex = this.tabs.indexOf(this.active);
    const hadPinned = list.some((t) => t.pinned);
    for (const t of list) {
      this.tabs.splice(this.tabs.indexOf(t), 1);
      if (this.fullscreenTab === t) this.setPageFullscreen(t, false);
      t.destroyView();
    }
    if (hadPinned && this.tabs.length) this.app.onPinnedChanged(this);
    if (!this.tabs.length) { this.active = null; this.base.close(); return; }
    if (!this.tabs.includes(this.active)) {
      this.active = null;
      this.activate(this.tabs[Math.min(Math.max(activeIndex, 0), this.tabs.length - 1)]);
    } else this.sendState();
  }

  recordClose(list) {
    const entries = list
      .filter((t) => !urls.isNewTab(t.url))
      .map((t) => ({ url: t.errorUrl || t.url, title: t.title, favicon: t.favicon, pinned: t.pinned, index: this.tabs.indexOf(t),
        navState: t.navState || (t.wc ? { index: t.wc.navigationHistory.getActiveIndex(),
          entries: t.wc.navigationHistory.getAllEntries().map(({ url, title }) => ({ url, title })) } : null) }))
      .sort((a, b) => a.index - b.index);
    if (!entries.length) return;
    this.closedTabs.push({ tabs: entries, activeUrl: list.includes(this.active) ? this.active.url : null });
  }

  // ⇧⌘T: undo the newest closing action, putting its tabs back where they were.
  reopenClosed() {
    return this.restoreAction(this.closedTabs.pop());
  }

  // Reopen one specific closing action (tab search → "Recently closed").
  reopenAction(id) {
    const action = this.closedTabs.list().find((a) => a.id === Number(id));
    if (!action) return false;
    this.closedTabs.remove(action.id);
    return this.restoreAction(action);
  }

  restoreAction(action) {
    if (!action) return false;
    const normal = this.tabs.filter((t) => !t.pinned); // a lone untouched New Tab (pinned tabs aside) gets replaced
    const blank = normal.length === 1 && urls.isNewTab(normal[0].url) && !normal[0].canGoBack() ? normal[0] : null;
    let focus = null;
    for (const e of action.tabs) {
      const t = new Tab(this, { url: e.url, title: e.title, favicon: e.favicon, pinned: !!e.pinned, navState: e.navState });
      this.tabs.splice(Math.min(e.index, this.tabs.length), 0, t);
      if (!focus || e.url === action.activeUrl) focus = t;
    }
    this.normalizePinned();
    this.activate(focus);
    if (blank) this.close(blank, { record: false });
    this.sendState();
    return true;
  }

  move(tab, index) {
    const from = this.tabs.indexOf(tab);
    if (from < 0) return;
    this.tabs.splice(from, 1);
    const pinnedCount = this.tabs.filter((t) => t.pinned).length;
    let to = Math.max(0, Math.min(index, this.tabs.length));
    to = tab.pinned ? Math.min(to, pinnedCount) : Math.max(to, pinnedCount);
    this.tabs.splice(to, 0, tab);
    if (tab.pinned) this.app.onPinnedChanged(this);
    this.sendState();
  }

  setPinned(tab, pinned) {
    if (!tab || tab.pinned === !!pinned) return;
    tab.pinned = !!pinned;
    this.normalizePinned();
    this.sendState();
    this.app.onPinnedChanged(this);
  }

  // Pinned tabs always sit at the start, in their current relative order.
  normalizePinned() {
    this.tabs = [...this.tabs.filter((t) => t.pinned), ...this.tabs.filter((t) => !t.pinned)];
  }

  onTabChanged(tab) {
    if (tab === this.active) this.app.onActiveTabChanged(this);
    if (tab.pinned && tab.url !== tab.savedUrl) { tab.savedUrl = tab.url; this.app.onPinnedChanged(this); }
    this.sendState();
  }

  // Tab search popup data: this window's tabs + recently closed.
  searchData() {
    return {
      tabs: this.tabs.map((t) => ({ ...t.state(), active: t === this.active })),
      closed: this.closedTabs.list(12).map((a) => ({ id: a.id, t: a.t,
        tabs: a.tabs.map((x) => ({ title: x.title || x.url, url: x.url, favicon: x.favicon || null })) })),
    };
  }

  onTabFocus() {
    // Nothing to do: while a popup is open the UI covers the page, so a real click can't focus it
    // (the UI closes popups on outside clicks itself). A page that grabs focus by script — e.g. after a
    // login form navigates — must not close the "Save password?" prompt.
  }

  // ---------- address bar ----------
  navigate(input, { tab = this.active, typed = false, disposition = 'current' } = {}) {
    const url = urls.fromInput(input);
    if (!url) return;
    if (disposition !== 'current' || !tab) return this.newTab(url, { background: disposition === 'background', typed });
    tab.load(url, { typed });
    if (tab === this.active) { this.stack(); tab.focus(); }
  }

  // ---------- find in page (hud) ----------
  openFind() {
    if (!this.active || this.active.asleep) return;
    this.findOpen = true;
    this.sendHud({ focusFind: true });
    this.hud.webContents.focus();
  }
  find(text, { forward = true, followUp = false } = {}) {
    const wc = this.active?.wc;
    if (!wc) return;
    if (!text) { wc.stopFindInPage('clearSelection'); this.sendHud({ findResult: null }); return; }
    wc.findInPage(String(text), { forward, findNext: !followUp });
  }
  closeFind(refocus = true) {
    this.findOpen = false;
    for (const t of this.tabs) { try { t.wc?.stopFindInPage('clearSelection'); } catch {} }
    this.sendHud({ findResult: null });
    if (refocus) this.focusActive();
  }
  onFindResult(tab, result) {
    if (tab === this.active && this.findOpen) this.sendHud({ findResult: { active: result.activeMatchOrdinal, matches: result.matches } });
  }

  // ---------- phone remote helpers ----------
  toggleQR(force) {
    this.qrVisible = typeof force === 'boolean' ? force : !this.qrVisible;
    this.sendHud();
    this.sendUI('qr-visible', this.qrVisible);
  }

  // Short notice over the page (top right), gone after a few seconds.
  showToast(text, ms = 9000) {
    this.toast = String(text);
    clearTimeout(this.toastTimer);
    this.sendHud();
    this.toastTimer = setTimeout(() => { this.toast = null; this.sendHud(); }, ms);
  }

  showCursor(x, y, click = false) {
    const c = this.content;
    this.cursor.setBounds({ x: Math.round(c.x + x - 12), y: Math.round(c.y + y - 12), width: 24, height: 24 });
    if (!this.cursorOn) { this.cursorOn = true; this.stack(); }
    if (click) this.cursor.webContents.executeJavaScript('window.pulse && window.pulse()').catch(() => {});
    clearTimeout(this.cursorTimer);
    this.cursorTimer = setTimeout(() => { this.cursorOn = false; this.stack(); }, 5000);
  }

  // ---------- closing ----------
  onClose() {
    if (this.closing) return;
    this.closing = true;
    // The whole window = one closing action, so ⇧⌘T after relaunch brings it all back.
    if (!this.private && this.tabs.length) this.recordClose([...this.tabs]);
    this.app.onWindowClosing(this);
  }

  onClosed() {
    this.destroyed = true;
    clearTimeout(this.stateTimer);
    clearTimeout(this.cursorTimer);
    for (const t of this.tabs) t.destroyView();
    this.tabs = [];
    for (const v of [this.chrome, this.hud, this.cursor]) { try { v.webContents.close(); } catch {} }
    this.app.onWindowClosed(this);
  }
}

module.exports = { Win, themeBackground };
