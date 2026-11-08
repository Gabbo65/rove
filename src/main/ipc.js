// Messages from the browser UI (toolbar, hud) and from our built-in pages (new tab, history…).
// Every handler first checks WHO sent it: UI messages only from a window's own UI views,
// page messages only from the top frame of the matching pb:// page. Web pages get nothing.
const { ipcMain, Menu } = require('electron');
const urls = require('./urls');
const favorites = require('./favorites');
const history = require('./history');
const downloads = require('./downloads');
const settings = require('./settings');

function register(hub) {
  // ---------- browser UI (chrome + hud views) ----------
  const ui = (channel, fn) => ipcMain.on(channel, (e, ...args) => {
    const win = hub.fromChrome(e.sender);
    if (!win) return;
    try { fn(win, ...args); } catch (err) { console.error(`[ipc ${channel}]`, err); }
  });
  const uiInvoke = (channel, fn) => ipcMain.handle(channel, async (e, ...args) => {
    const win = hub.fromChrome(e.sender);
    if (!win) throw new Error('not allowed');
    return fn(win, ...args);
  });

  ui('ui:content-rect', (win, r) => win.setContentRect(r || {}));
  ui('ui:overlay', (win, open) => win.setOverlay(open));
  ui('hud:size', (win, size) => win.setHudSize(size));
  ui('hud:toast-close', (win) => { win.toast = null; win.sendHud(); });
  ui('ui:focus-page', (win) => win.focusActive());

  // tabs
  ui('tab:new', (win, o = {}) => win.newTab(o.url ? urls.fromInput(o.url) : undefined, { background: !!o.background, index: o.index }));
  ui('tab:activate', (win, id) => win.activate(win.tab(id)));
  ui('tab:close', (win, id) => { const t = win.tab(id); if (t) win.close(t); });
  ui('tab:close-others', (win, id) => win.closeMany(win.tabs.filter((t) => t.id !== Number(id) && !t.pinned)));
  ui('tab:close-right', (win, id) => { const t = win.tab(id); if (t) win.closeMany(win.tabs.slice(win.tabs.indexOf(t) + 1)); });
  ui('tab:move', (win, { id, index } = {}) => { const t = win.tab(id); if (t && Number.isInteger(index)) win.move(t, index); });
  ui('tab:pin', (win, { id, pinned } = {}) => win.setPinned(win.tab(id), !!pinned));
  ui('tab:sleep', (win, id) => win.tab(id)?.sleep());
  ui('tab:duplicate', (win, id) => { const t = win.tab(id); if (t) win.newTab(t.errorUrl || t.url, { opener: t }); });
  ui('tab:reload', (win, id) => win.tab(id)?.reload());
  ui('tab:reopen', (win) => win.reopenClosed());
  ui('tab:reopen-action', (win, id) => win.reopenAction(id));
  uiInvoke('tabs:search-data', (win) => win.searchData());

  // navigation
  ui('nav', (win, action) => {
    const t = win.active;
    if (!t) return;
    if (action === 'back') t.back();
    else if (action === 'forward') t.forward();
    else if (action === 'reload') t.reload();
    else if (action === 'stop') t.stop();
  });
  ui('navigate', (win, { input, disposition = 'current', typed = true } = {}) =>
    win.navigate(String(input || ''), { typed, disposition }));

  // find bar (hud)
  ui('find', (win, { text, forward = true, followUp = false } = {}) => win.find(text, { forward, followUp }));
  ui('find:close', (win) => win.closeFind());

  // phone QR
  ui('qr:toggle', (win) => win.toggleQR());

  // favorites
  uiInvoke('fav:add-current', (win) => hub.addFavoriteFromTab(win, win.active));
  uiInvoke('fav:update', (_win, { id, title, url } = {}) => {
    const clean = urls.fromInput(url);
    if (!clean || !/^https?:|^file:/i.test(clean) || clean === urls.searchUrl(String(url || '').trim())) return { error: 'url' };
    return favorites.update(Number(id), { title: String(title ?? '').trim(), url: clean });
  });
  ui('fav:remove', (_win, id) => favorites.remove(Number(id)));
  ui('fav:reorder', (_win, ids) => Array.isArray(ids) && favorites.reorder(ids.map(Number)));
  ui('fav:open', (win, { url, disposition = 'current' } = {}) => {
    if (!/^https?:|^file:/i.test(url || '')) return;
    if (disposition === 'current') win.navigate(url, { typed: false });
    else win.newTab(url, { background: disposition === 'background', opener: win.active });
  });

  // address bar suggestions
  uiInvoke('omnibox:local', (win, text) => require('./suggest').local(String(text || ''), { win }));
  uiInvoke('omnibox:remote', (_win, text) => require('./suggest').remote(String(text || '')));
  ui('omnibox:delete', (_win, url) => { if (typeof url === 'string') history.deleteUrl(url); });

  // history popup
  uiInvoke('history:recent', () => history.recent(15));
  ui('history:open-page', (win) => hub.openInternal('history', win));

  // downloads
  ui('downloads:action', (win, { id, action } = {}) => downloads.action(id, action, { retryFrom: win.active?.wc }));

  // settings the toolbar can change directly (favorites bar)
  ui('settings:set', (_win, patch) => settings.set(patch));
  ui('settings:open', (win) => hub.openInternal('settings', win));

  // engine updates
  ui('update:open', () => require('./updates').prompt());

  // windows
  ui('win:new', (_win, { isPrivate = false } = {}) => hub.create({ isPrivate }));

  // native popup menu for the UI (tab + favorite right-clicks); resolves to the chosen item's id
  uiInvoke('menu:popup', (win, items) => new Promise((resolve) => {
    let chosen = null;
    const template = (items || []).map((it) => (it.type === 'separator' ? { type: 'separator' }
      : { label: String(it.label), enabled: it.enabled !== false, type: it.checked !== undefined ? 'checkbox' : 'normal',
        checked: !!it.checked, click: () => { chosen = it.id; } }));
    Menu.buildFromTemplate(template).popup({ window: win.base, callback: () => setImmediate(() => resolve(chosen)) });
  }));

  // ---------- built-in pages (pb://newtab, pb://history, pb://error, pb://settings) ----------
  const PAGE_API = {
    newtab: {
      favorites: () => favorites.list(),
      info: (ctx) => ({ private: ctx.win.private }),
      search: (ctx, text) => { ctx.win.navigate(String(text || ''), { tab: ctx.tab, typed: true }); },
    },
    history: {
      query: (_ctx, opts) => history.query(opts || {}),
      delete: (_ctx, ids) => history.deleteVisits(ids),
      clear: () => history.clear(),
      open: (ctx, { url, newTab } = {}) => {
        if (!/^https?:/i.test(url || '')) return;
        if (newTab) ctx.win.newTab(url, { background: true, opener: ctx.tab });
        else ctx.tab.load(url);
      },
    },
    error: {
      retry: (ctx) => ctx.tab.reload(),
    },
    settings: require('./settings-page').api(hub),
  };
  hub.PAGE_API = PAGE_API; // features add their page calls here (settings, passwords…)

  ipcMain.handle('page', async (e, name, ...args) => {
    if (e.senderFrame !== e.sender.mainFrame) throw new Error('not allowed');
    const page = urls.internalPage(e.senderFrame.url);
    const tab = hub.fromTabWebContents(e.sender);
    const fn = page && tab && PAGE_API[page]?.[name];
    if (!fn) throw new Error('not allowed');
    return fn({ tab, win: tab.win, page }, ...args);
  });
}

module.exports = { register };
