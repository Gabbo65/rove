// Browser UI: tabs, toolbar, favorites bar, remote QR.
const $ = (id) => document.getElementById(id);
const stage = $('stage'), tabsEl = $('tabs'), url = $('url');
const NEWTAB = new URL('newtab.html', location.href).href;
const HISTORY = new URL('history.html', location.href).href;
const INTERNAL_BASE = new URL('./', location.href).href;
// "Internal" = our built-in pages (new tab, history): no address shown, not saved to history.
const isInternal = (u) => !u || u.startsWith(INTERNAL_BASE);
const isNewTab = (u) => !u || u.startsWith(NEWTAB);
const internalTitle = (u) => (u && u.startsWith(HISTORY) ? 'History' : 'New Tab');

// ---------- small storage helpers (per-user, survives restarts) ----------
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
};

// Turn what the user typed into a URL (or a Google search).
function toUrl(input) {
  const s = (input || '').trim();
  if (!s) return null;
  if (/^[a-z][\w+.-]*:\/\//i.test(s) || /^(about|data|file):/i.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s)) return 'http://' + s;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s)) return 'https://' + s;
  return 'https://www.google.com/search?q=' + encodeURIComponent(s);
}

const ICON_CLOSE = '<svg viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13"/></svg>';
const ICON_LOCK = '<svg viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';
const ICON_HISTORY = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></svg>';
const ICON_GLOBE = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/></svg>';

function faviconNode(src, label) {
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.onerror = () => img.replaceWith(letterNode(label));
    return img;
  }
  return letterNode(label);
}
function letterNode(label) {
  const d = document.createElement('div');
  d.className = 'letter';
  d.textContent = ((label || '').replace(/^https?:\/\/(www\.)?/, '')[0] || '•');
  return d;
}

// =====================================================================
// Tabs
// =====================================================================
let tabs = [];
let active = null;
let nextId = 1;

function createTab(target, { background = false, index } = {}) {
  const tab = { id: nextId++, title: 'New Tab', url: target || NEWTAB, favicon: null, loading: false, ready: false };

  const view = document.createElement('webview');
  view.setAttribute('allowpopups', '');
  view.setAttribute('src', tab.url);
  view.className = 'hidden';
  tab.view = view;

  const el = document.createElement('div');
  el.className = 'tab';
  el.draggable = true;
  el.innerHTML = `<div class="fav"></div><div class="title"></div><button class="close" title="Close tab (⌘W)">${ICON_CLOSE}</button>`;
  tab.el = el;

  el.addEventListener('mousedown', (e) => {
    if (e.button === 0 && !e.target.closest('.close')) activate(tab);
  });
  el.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(tab); }); // middle-click
  el.querySelector('.close').addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); tabMenu(tab); });
  setupDrag(tab);

  // ---- page events ----
  view.addEventListener('dom-ready', () => {
    if (!tab.ready) { tab.ready = true; if (tab === active) window.bridge.activeTab(view.getWebContentsId()); }
    if (isNewTab(view.getURL())) sendFavoritesTo(tab);
  });
  view.addEventListener('ipc-message', (e) => { if (e.channel === 'internal') handleInternal(tab, ...e.args); });
  view.addEventListener('found-in-page', (e) => { if (tab === active) showFindResult(e.result); });
  view.addEventListener('focus', closePanels);
  view.addEventListener('did-start-loading', () => { tab.loading = true; renderTab(tab); syncToolbar(); });
  view.addEventListener('did-stop-loading', () => { tab.loading = false; renderTab(tab); syncToolbar(); });
  const onNav = (e) => {
    tab.url = e.url || view.getURL();
    if (isInternal(tab.url)) { tab.title = internalTitle(tab.url); tab.favicon = null; }
    renderTab(tab); syncToolbar();
  };
  view.addEventListener('did-navigate', (e) => { tab.favicon = null; onNav(e); addHistory(tab); });
  view.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) onNav(e); });
  view.addEventListener('page-title-updated', (e) => {
    if (!isInternal(view.getURL())) { tab.title = e.title; renderTab(tab); updateHistory(tab); }
    if (tab === active) document.title = tab.title;
  });
  view.addEventListener('page-favicon-updated', (e) => { tab.favicon = e.favicons[0] || null; renderTab(tab); updateHistory(tab); });
  view.addEventListener('did-fail-load', (e) => {
    if (e.isMainFrame && e.errorCode !== -3) { tab.title = 'Can’t reach this page'; renderTab(tab); }
  });

  const at = index ?? (active ? tabs.indexOf(active) + 1 : tabs.length);
  tabs.splice(at, 0, tab);
  stage.appendChild(view);
  layoutTabs();
  renderTab(tab);
  if (!background || !active) activate(tab);
  return tab;
}

function renderTab(tab) {
  const fav = tab.el.querySelector('.fav');
  fav.replaceChildren(tab.loading ? Object.assign(document.createElement('div'), { className: 'spinner' })
    : isInternal(tab.url) ? Object.assign(document.createElement('div'), { innerHTML: tab.url.startsWith(HISTORY) ? ICON_HISTORY : ICON_GLOBE })
    : faviconNode(tab.favicon, tab.title || tab.url));
  tab.el.querySelector('.title').textContent = tab.title || tab.url;
  tab.el.title = tab.title + (isInternal(tab.url) ? '' : '\n' + tab.url);
  emitTabs();
}

function activate(tab) {
  if (!tab || tab === active) return;
  active?.el.classList.remove('active');
  active?.view.classList.add('hidden');
  active = tab;
  tab.el.classList.add('active');
  tab.view.classList.remove('hidden');
  tab.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (tab.ready) window.bridge.activeTab(tab.view.getWebContentsId());
  document.title = tab.title;
  closeFind();
  syncToolbar();
  emitTabs();
  if (isNewTab(tab.url)) setTimeout(() => url.focus(), 0);
  else tab.view.focus();
}

function closeTab(tab, { record = true } = {}) {
  const i = tabs.indexOf(tab);
  if (i < 0) return;
  if (record) recordClose([tab]);
  tabs.splice(i, 1);
  if (tab === active) {
    active = null;
    if (tabs.length) activate(tabs[Math.min(i, tabs.length - 1)]);
  }
  tab.el.remove();
  tab.view.remove();
  layoutTabs();
  emitTabs();
  if (!tabs.length) window.close(); // like Edge: last tab closes the window
}

// Several tabs closed in one go count as ONE action, so ⇧⌘T brings them all back together.
function closeTabs(list) {
  if (!list.length) return;
  recordClose(list);
  list.forEach((t) => closeTab(t, { record: false }));
}
function closeOthers(keep) { closeTabs(tabs.filter((t) => t !== keep)); }
function closeRight(of) { closeTabs(tabs.slice(tabs.indexOf(of) + 1)); }

// =====================================================================
// Closed-tab history (⇧⌘T)
// Each entry is one closing action: a single tab, "close others", "close to the right",
// or the whole window when you quit. ⇧⌘T undoes the newest action first. Survives restarts.
// =====================================================================
let closeHistory = store.get('closeHistory', []); // [{ tabs: [{ url, index }], active: url|null }]
const MAX_CLOSE_ACTIONS = 30;

function recordClose(list) {
  const entries = list.filter((t) => !isNewTab(t.url))
    .map((t) => ({ url: t.url, index: tabs.indexOf(t) }))
    .sort((a, b) => a.index - b.index);
  if (!entries.length) return;
  closeHistory.push({ tabs: entries, active: list.includes(active) ? active.url : null });
  if (closeHistory.length > MAX_CLOSE_ACTIONS) closeHistory.splice(0, closeHistory.length - MAX_CLOSE_ACTIONS);
  store.set('closeHistory', closeHistory);
}

function reopenClosed() {
  const action = closeHistory.pop();
  if (!action) return;
  store.set('closeHistory', closeHistory);
  // A lone untouched New Tab gets replaced, like Edge does.
  const blank = tabs.length === 1 && isNewTab(tabs[0].url) ? tabs[0] : null;
  let focus = null;
  for (const e of action.tabs) {
    const t = createTab(e.url, { background: true, index: Math.min(e.index, tabs.length) });
    if (!focus || e.url === action.active) focus = t;
  }
  activate(focus);
  if (blank) closeTab(blank, { record: false });
}

async function tabMenu(tab) {
  const i = tabs.indexOf(tab);
  const choice = await window.bridge.popupMenu([
    { id: 'new', label: 'New Tab to the Right' },
    { type: 'separator' },
    { id: 'reload', label: 'Reload' },
    { id: 'dup', label: 'Duplicate Tab' },
    { id: 'fav', label: isFavorite(tab.url) ? 'Remove from Favorites' : 'Add to Favorites', enabled: !isInternal(tab.url) },
    { type: 'separator' },
    { id: 'close', label: 'Close Tab' },
    { id: 'others', label: 'Close Other Tabs', enabled: tabs.length > 1 },
    { id: 'right', label: 'Close Tabs to the Right', enabled: i < tabs.length - 1 },
    { type: 'separator' },
    { id: 'reopen', label: 'Reopen Closed Tab', enabled: closeHistory.length > 0 },
  ]);
  if (choice === 'new') createTab(null, { index: i + 1 });
  if (choice === 'reload') tab.view.reload();
  if (choice === 'dup') createTab(tab.url, { index: i + 1 });
  if (choice === 'fav') toggleFavorite(tab);
  if (choice === 'close') closeTab(tab);
  if (choice === 'others') closeOthers(tab);
  if (choice === 'right') closeRight(tab);
  if (choice === 'reopen') reopenClosed();
}

// Tabs shrink as you add more; very narrow tabs show only the icon.
function layoutTabs() {
  tabsEl.replaceChildren(...tabs.map((t) => t.el));
  requestAnimationFrame(() => {
    for (const t of tabs) t.el.classList.toggle('narrow', t.el.offsetWidth < 84);
  });
}
new ResizeObserver(layoutTabs).observe($('tabstrip'));

// Drag tabs to reorder them.
let dragging = null;
function setupDrag(tab) {
  tab.el.addEventListener('dragstart', (e) => {
    dragging = tab; tab.el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/uri-list', tab.url);
  });
  tab.el.addEventListener('dragend', () => { dragging = null; tab.el.classList.remove('dragging'); });
  tab.el.addEventListener('dragover', (e) => {
    if (!dragging || dragging === tab) return;
    e.preventDefault();
    const r = tab.el.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    tabs.splice(tabs.indexOf(dragging), 1);
    tabs.splice(tabs.indexOf(tab) + (after ? 1 : 0), 0, dragging);
    layoutTabs();
  });
}


// =====================================================================
// Toolbar
// =====================================================================
const back = $('back'), forward = $('forward'), reload = $('reload'), star = $('star');

function syncToolbar() {
  const tab = active;
  if (!tab) return;
  const ready = tab.ready;
  const shown = isInternal(tab.url) ? '' : tab.url;
  if (document.activeElement !== url) url.value = shown;
  back.disabled = !(ready && tab.view.canGoBack());
  forward.disabled = !(ready && tab.view.canGoForward());
  reload.classList.toggle('loading', tab.loading);
  $('loading').classList.toggle('on', tab.loading);
  $('lock').innerHTML = shown.startsWith('https://') ? ICON_LOCK : '';
  star.classList.toggle('on', isFavorite(tab.url));
  star.disabled = isInternal(tab.url);
}

function go(input, tab = active) {
  const target = toUrl(input);
  if (!target || !tab) return;
  tab.url = target;
  tab.view.loadURL(target).catch(() => {}); // aborted loads (you clicked elsewhere) are normal
  tab.view.focus();
}

$('urlform').addEventListener('submit', (e) => {
  e.preventDefault();
  go(url.value);
  url.blur();
});
url.addEventListener('focus', () => url.select());
url.addEventListener('blur', syncToolbar);
url.addEventListener('keydown', (e) => { if (e.key === 'Escape') { url.blur(); active?.view.focus(); } });
back.onclick = () => active?.view.canGoBack() && active.view.goBack();
forward.onclick = () => active?.view.canGoForward() && active.view.goForward();
reload.onclick = () => active && (active.loading ? active.view.stop() : active.view.reload());
$('newtab').onclick = () => createTab();
$('tabstrip').addEventListener('dblclick', (e) => { if (e.target.classList.contains('drag-fill')) createTab(); });

// =====================================================================
// Favorites
// =====================================================================
let favorites = store.get('favorites', []);
const favKey = (u) => (u || '').replace(/#.*$/, '').replace(/\/$/, '');
const isFavorite = (u) => !isInternal(u) && favorites.some((f) => favKey(f.url) === favKey(u));

// Add or remove a page. Adding always opens the edit popup so you pick the name first.
function toggleFavorite(tab = active) {
  if (!tab || isInternal(tab.url)) return;
  if (isFavorite(tab.url)) {
    favorites = favorites.filter((f) => favKey(f.url) !== favKey(tab.url));
    saveFavorites();
    return;
  }
  const f = { url: tab.url, title: tab.title || '', favicon: tab.favicon };
  favorites.push(f);
  saveFavorites();
  const el = [...$('favs').children].find((x) => x.fav === f);
  const barVisible = !document.body.classList.contains('no-favbar');
  editFavorite(f, el && barVisible ? el : star, { added: true });
}

function saveFavorites() {
  store.set('favorites', favorites);
  renderFavorites();
  syncToolbar();
  for (const t of tabs) if (isNewTab(t.url) && t.ready) sendFavoritesTo(t);
  emitFavorites();
}

function renderFavorites() {
  $('favs').replaceChildren(...favorites.map((f) => {
    const b = document.createElement('button');
    b.className = 'favitem';
    b.title = f.title ? `${f.title}\n${f.url}` : f.url;
    b.draggable = true;
    b.fav = f;
    b.append(faviconNode(f.favicon, f.title || f.url));
    // An empty name is allowed: then the favorite shows just its icon.
    if (f.title) {
      const label = document.createElement('span');
      label.textContent = f.title;
      b.append(label);
    } else b.classList.add('icon-only');
    b.addEventListener('click', (e) => (e.metaKey ? createTab(f.url, { background: true }) : go(f.url)));
    b.addEventListener('auxclick', (e) => { if (e.button === 1) createTab(f.url, { background: true }); });
    b.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      const c = await window.bridge.popupMenu([
        { id: 'open', label: 'Open' },
        { id: 'tab', label: 'Open in New Tab' },
        { type: 'separator' },
        { id: 'edit', label: 'Edit…' },
        { id: 'remove', label: 'Remove' },
      ]);
      if (c === 'open') go(f.url);
      if (c === 'tab') createTab(f.url);
      if (c === 'edit') editFavorite(f, b);
      if (c === 'remove') { favorites.splice(favorites.indexOf(f), 1); saveFavorites(); }
    });
    setupFavDrag(b);
    return b;
  }));
}

// Drag favorites left/right to reorder (same feel as tabs).
let favDragging = null;
function setupFavDrag(el) {
  el.addEventListener('dragstart', (e) => {
    favDragging = el; el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/uri-list', el.fav.url);
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    favDragging = null;
    // DOM order is the new order
    favorites = [...$('favs').children].map((x) => x.fav);
    saveFavorites();
  });
  el.addEventListener('dragover', (e) => {
    if (!favDragging || favDragging === el) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    el.parentNode.insertBefore(favDragging, after ? el.nextSibling : el);
  });
}

// ---- Edit popup (Edge-style): name + URL, Remove / Cancel / Done ----
const favPop = $('fav-pop'), fpName = $('fp-name'), fpUrl = $('fp-url');
let editing = null; // the favorite object being edited

function editFavorite(f, anchor, { added = false } = {}) {
  closePanels();
  editing = f;
  $('fp-title').textContent = added ? 'Favorite added' : 'Edit favorite';
  fpName.value = f.title;
  fpUrl.value = f.url;
  fpUrl.classList.remove('bad');
  favPop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = favPop.offsetWidth;
  favPop.style.top = `${r.bottom + 6}px`;
  favPop.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8))}px`;
  fpName.focus();
  fpName.select();
}

function closeFavPop() { favPop.hidden = true; editing = null; }

function saveFavPop() {
  if (!editing) return closeFavPop();
  const raw = fpUrl.value.trim();
  const u = toUrl(raw);
  // Must look like an address, not a search
  if (!u || (u.startsWith('https://www.google.com/search?q=') && !/google\./.test(raw))) {
    fpUrl.classList.add('bad'); fpUrl.focus(); return;
  }
  const sameSite = (() => { try { return new URL(u).host === new URL(editing.url).host; } catch { return false; } })();
  editing.url = u;
  editing.title = fpName.value.trim(); // may be empty → icon only
  if (!sameSite) editing.favicon = null;
  closeFavPop();
  saveFavorites();
}

$('fp-save').onclick = saveFavPop;
$('fp-cancel').onclick = closeFavPop;
$('fp-remove').onclick = () => {
  if (editing) favorites.splice(favorites.indexOf(editing), 1);
  closeFavPop();
  saveFavorites();
};
for (const input of [fpName, fpUrl]) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveFavPop(); }
    if (e.key === 'Escape') { e.preventDefault(); closeFavPop(); }
  });
}
fpUrl.addEventListener('input', () => fpUrl.classList.remove('bad'));

// ☆ / ⌘D: add the page (if needed) and open the popup, like Edge.
function starPage() {
  const tab = active;
  if (!tab || isInternal(tab.url)) return;
  let f = favorites.find((x) => favKey(x.url) === favKey(tab.url));
  const added = !f;
  if (!f) return toggleFavorite(tab); // adds it and opens the popup
  editFavorite(f, star, { added });
}
star.onclick = starPage;

// The New Tab page shows favorites as tiles (it also asks for them itself when it loads).
function sendFavoritesTo(tab) {
  try {
    tab.view.send('internal', 'favorites',
      favorites.map(({ url: u, title, favicon }) => ({ url: u, title, favicon })));
  } catch {}
}

// ---- Phone: favorites list ----
let favTimer;
function emitFavorites() {
  clearTimeout(favTimer);
  favTimer = setTimeout(() => window.bridge.favoritesUpdate(
    favorites.map(({ url: u, title, favicon }) => ({ url: u, title, favicon }))), 100);
}

function setFavbar(show) {
  document.body.classList.toggle('no-favbar', !show);
  store.set('favbar', show);
}

// =====================================================================
// Remote: status button + QR code
// =====================================================================
const qr = $('qr'), remoteBtn = $('remote-btn'), cursor = $('cursor');

function setQR(show) {
  qr.hidden = !show;
  remoteBtn.classList.toggle('qr-open', show);
}
// The button always toggles, whatever the connection state.
remoteBtn.onclick = () => setQR(qr.hidden);

let lastClients = null;
window.bridge.on('remote-status', ({ clients, url: addr, qr: qrData }) => {
  remoteBtn.classList.toggle('on', clients > 0);
  $('remote-label').textContent =
    clients === 0 ? 'No remote' : clients === 1 ? 'iPhone connected' : `${clients} remotes`;
  $('qr-img').src = qrData;
  $('qr-addr').textContent = addr.replace(/^https?:\/\//, '').replace(/\/?\?.*$/, '');
  $('qr-title').textContent = clients > 0 ? 'Connected — scan to add another' : 'Waiting for a device…';
  // Automatic behaviour only when the connection changes: show when nobody's connected, hide when one joins.
  if (lastClients === null || (lastClients === 0) !== (clients === 0)) setQR(clients === 0);
  if (clients === 0) cursor.hidden = true;
  lastClients = clients;
});

// Trackpad cursor drawn over the page.
let clickTimer;
window.bridge.on('cursor', ({ x, y, visible, click }) => {
  cursor.hidden = !visible;
  cursor.style.left = x + 'px';
  cursor.style.top = y + 'px';
  if (click) {
    cursor.classList.add('click');
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => cursor.classList.remove('click'), 120);
  }
});

// Phone navigation acts on the active tab.
window.bridge.on('navigate', ({ action, input }) => {
  if (action === 'go') go(input);
  else if (action === 'back') back.onclick();
  else if (action === 'forward') forward.onclick();
  else if (action === 'reload') active?.view.reload();
});

window.bridge.on('open-tab', ({ url: u, background }) => createTab(u, { background }));

// Menu shortcuts from the main process.
window.bridge.on('command', ({ name, dir, index, action, id, url: target }) => {
  switch (name) {
    case 'new-tab': createTab(); break;
    case 'close-tab': closeTab(active); break;
    case 'reopen-tab': reopenClosed(); break;
    case 'focus-url': url.focus(); break;
    case 'reload': active?.view.reload(); break;
    case 'back': back.onclick(); break;
    case 'forward': forward.onclick(); break;
    case 'toggle-favorite': starPage(); break;
    case 'toggle-favbar': setFavbar(document.body.classList.contains('no-favbar')); break;
    case 'toggle-qr': setQR(qr.hidden); break;
    case 'find': openFind(); break;
    case 'find-next': findNext(dir); break;
    case 'history': openHistory(); break;
    case 'downloads': toggleDownloads(); break;
    case 'remote-fav':
      if (action === 'open') go(target);
      else if (action === 'open-new') createTab(target);
      else if (action === 'toggle') toggleFavorite();
      break;
    case 'remote-tab': {
      const t = tabs.find((x) => x.id === Number(id));
      if (action === 'new') createTab();
      else if (t && action === 'select') activate(t);
      else if (t && action === 'close') closeTab(t);
      break;
    }
    case 'next-tab': activate(tabs[(tabs.indexOf(active) + dir + tabs.length) % tabs.length]); break;
    case 'select-tab': activate(index === -1 ? tabs[tabs.length - 1] : tabs[index]); break;
  }
});

// Page area size → main, so remote taps and the cursor map correctly.
new ResizeObserver(() => window.bridge.viewSize(stage.clientWidth, stage.clientHeight)).observe(stage);

// =====================================================================
// Phone remote: tab list
// =====================================================================
let tabsTimer;
function emitTabs() {
  clearTimeout(tabsTimer);
  tabsTimer = setTimeout(() => window.bridge.tabsUpdate(tabs.map((t) => ({
    id: t.id, title: t.title, url: isInternal(t.url) ? '' : t.url, favicon: t.favicon, active: t === active,
  }))), 120);
}

// =====================================================================
// Find in page (⌘F, ⌘G, ⇧⌘G)
// =====================================================================
const findbar = $('findbar'), findInput = $('find-input'), findCount = $('find-count');

function openFind() {
  findbar.hidden = false;
  document.body.classList.add('finding');
  findInput.focus();
  findInput.select();
  if (findInput.value) runFind();
}
function closeFind() {
  if (findbar.hidden) return;
  findbar.hidden = true;
  document.body.classList.remove('finding');
  findCount.textContent = '';
  for (const t of tabs) { try { if (t.ready) t.view.stopFindInPage('clearSelection'); } catch {} }
}
// followUp=false starts a new search (text changed); true jumps to next/previous match.
function runFind(forward = true, followUp = false) {
  if (!active?.ready) return;
  const text = findInput.value;
  if (!text) { active.view.stopFindInPage('clearSelection'); findCount.textContent = ''; findbar.classList.remove('none'); return; }
  active.view.findInPage(text, { forward, findNext: !followUp });
}
function findNext(dir) { if (findbar.hidden) openFind(); else runFind(dir > 0, true); }
function showFindResult(r) {
  if (findbar.hidden || !findInput.value) return;
  findCount.textContent = r.matches ? `${r.activeMatchOrdinal}/${r.matches}` : '0/0';
  findbar.classList.toggle('none', !r.matches);
}
findInput.addEventListener('input', () => runFind());
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); runFind(!e.shiftKey, true); }
  if (e.key === 'Escape') { closeFind(); active?.view.focus(); }
});
$('find-prev').onclick = () => runFind(false, true);
$('find-next').onclick = () => runFind(true, true);
$('find-close').onclick = () => { closeFind(); active?.view.focus(); };

// =====================================================================
// History (⌘Y)
// =====================================================================
let historyList = store.get('history', []); // newest first: { url, title, favicon, t }
let historyTimer;

function saveHistory() {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => { store.set('history', historyList); pushHistoryPages(); }, 400);
}
function addHistory(tab) {
  const u = tab.view.getURL();
  if (isInternal(u) || !/^https?:/i.test(u)) return;
  const top = historyList[0];
  // Same page again within a minute (reload, redirect bounce) is not a new visit.
  if (top && top.url === u && Date.now() - top.t < 60000) { tab.historyEntry = top; return; }
  const entry = { url: u, title: u, favicon: null, t: Date.now() };
  historyList.unshift(entry);
  if (historyList.length > 5000) historyList.length = 5000;
  tab.historyEntry = entry;
  saveHistory();
}
function updateHistory(tab) {
  const e = tab.historyEntry;
  if (!e || e.url !== tab.view.getURL()) return;
  if (tab.title) e.title = tab.title;
  if (tab.favicon) e.favicon = tab.favicon;
  saveHistory();
}
function pushHistoryPages() {
  for (const t of tabs) if (t.ready && t.url.startsWith(HISTORY)) t.view.send('internal', 'history', historyList);
}
function openHistory() {
  const existing = tabs.find((t) => t.url.startsWith(HISTORY));
  if (existing) activate(existing); else createTab(HISTORY);
}

// Messages from our built-in pages (history, new tab).
function handleInternal(tab, type, data) {
  if (type === 'get-history') tab.view.send('internal', 'history', historyList);
  else if (type === 'get-favorites') sendFavoritesTo(tab);
  else if (type === 'delete-history') {
    const keys = new Set((data || []).map((d) => d.t + '|' + d.url));
    historyList = historyList.filter((h) => !keys.has(h.t + '|' + h.url));
    saveHistory();
  } else if (type === 'clear-history') {
    historyList = [];
    saveHistory();
  } else if (type === 'open' && data?.url) {
    if (data.newTab) createTab(data.url, { background: true }); else go(data.url, tab);
  }
}

// =====================================================================
// Downloads (⇧⌘J)
// =====================================================================
const dlBtn = $('dl-btn'), dlPanel = $('dl-panel'), dlList = $('dl-list');
let dlItems = [];

const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB`
  : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);

window.bridge.on('downloads', ({ list, open }) => {
  dlItems = list;
  if (list.length) dlBtn.hidden = false;
  renderDownloads();
  if (open) showDownloads(true);
});

function showDownloads(show) {
  if (show) closePanels();
  dlPanel.hidden = !show;
  dlBtn.classList.toggle('open', show);
  if (show) dlBtn.hidden = false;
  else if (!dlItems.length) dlBtn.hidden = true;
}
function toggleDownloads() { showDownloads(dlPanel.hidden); }
// Only one popup at a time; clicking into the page or pressing Esc closes them.
function closePanels() {
  if (!dlPanel.hidden) showDownloads(false);
  if (!histPanel.hidden) showHistoryPanel(false);
  if (!favPop.hidden) closeFavPop();
}
// Clicks on the browser UI outside a popup close it too.
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#dl-panel, #dl-btn, #hist-panel, #hist-btn, #fav-pop, #star, .favitem')) closePanels();
});

// =====================================================================
// History popup (button right of the address bar)
// =====================================================================
const histBtn = $('hist-btn'), histPanel = $('hist-panel');

function timeLabel(t) {
  const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  const hm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (t >= today) return hm;
  if (t >= today - 864e5) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function showHistoryPanel(show) {
  if (show) {
    closePanels();
    renderHistoryPanel();
    const r = histBtn.getBoundingClientRect();
    histPanel.style.right = `${Math.max(8, innerWidth - r.right - 8)}px`;
  }
  histPanel.hidden = !show;
  histBtn.classList.toggle('open', show);
}

function renderHistoryPanel() {
  // Most recent pages, one row per address
  const seen = new Set(), recent = [];
  for (const h of historyList) {
    if (seen.has(h.url)) continue;
    seen.add(h.url); recent.push(h);
    if (recent.length >= 15) break;
  }
  $('hp-empty').hidden = recent.length > 0;
  $('hp-list').replaceChildren(...recent.map((h) => {
    const row = document.createElement('button');
    row.className = 'hp-row';
    row.title = h.url;
    const text = document.createElement('div'); text.className = 'hp-text';
    const t = document.createElement('div'); t.className = 'hp-title'; t.textContent = h.title || h.url;
    const d = document.createElement('div'); d.className = 'hp-host'; d.textContent = hostOf(h.url);
    text.append(t, d);
    const time = document.createElement('div'); time.className = 'hp-time'; time.textContent = timeLabel(h.t);
    row.append(faviconNode(h.favicon, hostOf(h.url)), text, time);
    row.onclick = (e) => { showHistoryPanel(false); e.metaKey ? createTab(h.url, { background: true }) : go(h.url); };
    row.addEventListener('auxclick', (e) => { if (e.button === 1) createTab(h.url, { background: true }); });
    return row;
  }));
}
histBtn.onclick = () => showHistoryPanel(histPanel.hidden);
$('hp-more').onclick = () => { showHistoryPanel(false); openHistory(); };
dlBtn.onclick = toggleDownloads;
$('dl-clear').onclick = () => window.bridge.downloadAction(null, 'clear');
$('dl-close').onclick = () => showDownloads(false);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanels(); });

function dlButton(label, svgPath, action, id) {
  const b = document.createElement('button');
  b.className = 'icon'; b.title = label;
  b.innerHTML = `<svg viewBox="0 0 16 16"><path d="${svgPath}"/></svg>`;
  b.onclick = (e) => { e.stopPropagation(); window.bridge.downloadAction(id, action); };
  return b;
}
const P_PAUSE = 'M6 4v8M10 4v8', P_PLAY = 'M5.5 3.5l7 4.5-7 4.5z', P_X = 'M4 4l8 8M12 4l-8 8',
  P_FOLDER = 'M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z', P_RETRY = 'M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3';

function renderDownloads() {
  const live = dlItems.filter((d) => d.state === 'progressing');
  const total = live.reduce((a, d) => a + d.total, 0), got = live.reduce((a, d) => a + d.received, 0);
  dlBtn.classList.toggle('active', live.length > 0);
  dlBtn.style.setProperty('--p', `${total ? (got / total) * 100 : 8}%`);
  $('dl-empty').hidden = dlItems.length > 0;

  dlList.replaceChildren(...dlItems.map((d) => {
    const row = document.createElement('div');
    row.className = 'dl-row ' + d.state + (d.missing ? ' missing' : '');
    const ext = (d.name.split('.').pop() || '').slice(0, 4);
    const icon = document.createElement('div');
    icon.className = 'dl-icon'; icon.textContent = d.name.includes('.') ? ext : '?';
    const info = document.createElement('div');
    info.className = 'dl-info';
    const name = document.createElement('div');
    name.className = 'dl-name'; name.textContent = d.name; name.title = d.path;
    const status = document.createElement('div');
    status.className = 'dl-status';
    if (d.state === 'progressing') {
      status.textContent = d.total ? `${fmtBytes(d.received)} of ${fmtBytes(d.total)}` : fmtBytes(d.received);
      if (d.paused) status.textContent += ' · Paused';
    } else if (d.state === 'completed') status.textContent = d.missing ? 'Deleted' : fmtBytes(d.total || d.received);
    else status.textContent = d.state === 'cancelled' ? 'Cancelled' : 'Failed';
    info.append(name, status);
    if (d.state === 'progressing') {
      const bar = document.createElement('div');
      bar.className = 'dl-bar';
      bar.style.setProperty('--w', d.total ? `${(d.received / d.total) * 100}%` : '30%');
      info.append(bar);
    }
    const actions = document.createElement('div');
    actions.className = 'dl-actions';
    if (d.state === 'progressing') {
      actions.append(d.paused ? dlButton('Resume', P_PLAY, 'resume', d.id) : dlButton('Pause', P_PAUSE, 'pause', d.id),
        dlButton('Cancel', P_X, 'cancel', d.id));
    } else {
      if (d.state === 'completed' && !d.missing) actions.append(dlButton('Show in Finder', P_FOLDER, 'show', d.id));
      if (d.state !== 'completed') actions.append(dlButton('Retry', P_RETRY, 'retry', d.id));
      actions.append(dlButton('Remove from list', P_X, 'remove', d.id));
    }
    row.append(icon, info, actions);
    if (d.state === 'completed' && !d.missing) row.onclick = () => window.bridge.downloadAction(d.id, 'open');
    return row;
  }));
}

// =====================================================================
// Start: always one fresh New Tab. Your last tabs are one ⇧⌘T away.
// =====================================================================
setFavbar(store.get('favbar', true));
renderFavorites();
emitFavorites();
// One-time: tabs saved by the old "restore on launch" feature become an undoable close action.
const oldSession = store.get('session', null);
if (oldSession?.tabs?.some(Boolean)) {
  const entries = oldSession.tabs.map((u, index) => ({ url: u, index })).filter((e) => e.url && !isNewTab(e.url));
  closeHistory.push({ tabs: entries, active: oldSession.tabs[oldSession.active] || null });
  store.set('closeHistory', closeHistory);
}
try { localStorage.removeItem('session'); } catch {}
createTab();

// Quitting or closing the window = one closing action, so ⇧⌘T after relaunch brings the whole window back.
window.addEventListener('beforeunload', () => { if (tabs.length) recordClose([...tabs]); });
window.bridge.downloadsGet();
