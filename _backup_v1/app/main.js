// Personal Browser — main process.
// Runs the browser window AND the remote-control server the phone connects to.
const { app, BrowserWindow, ipcMain, webContents, Menu, clipboard, dialog, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

// Display name for menus — but keep the data folder (tabs, favorites, remote key) where it already is.
const dataDir = app.getPath('userData');
app.setName('Personal Browser');
app.setPath('userData', dataDir);

const PORT = 8765;
const MIRROR_FPS = 15;
const { pathToFileURL } = require('url');
const NEWTAB_URL = pathToFileURL(path.join(__dirname, 'browser', 'newtab.html')).href;
const INTERNAL_BASE = pathToFileURL(path.join(__dirname, 'browser')).href + '/';   // our built-in pages
const INTERNAL_TITLES = { 'newtab.html': 'New Tab', 'history.html': 'History' };

let win = null;       // browser window
let guest = null;     // webContents of the ACTIVE tab (what the remote drives)
const view = { w: 1200, h: 800 };          // page area size (DIP)
const cursor = { x: 600, y: 400 };         // trackpad cursor (page coords)
let cursorHideTimer = null;

// ---------- helpers ----------
function lanIP() {
  const nets = os.networkInterfaces();
  const order = ['en0', 'en1', ...Object.keys(nets)];
  for (const name of order) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return '127.0.0.1';
}

// Secret key, so only someone who scanned the QR (or has the link) can drive the browser.
function remoteKey() {
  const file = path.join(app.getPath('userData'), 'remote.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).key; } catch {}
  const key = crypto.randomBytes(6).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ key }));
  return key;
}

// Self-signed HTTPS certificate for the current Wi-Fi address (iPhone Safari may refuse plain HTTP).
// Made once per address with macOS's built-in openssl, then reused.
function tlsCert(ip) {
  const dir = path.join(app.getPath('userData'), 'tls');
  const keyFile = path.join(dir, `${ip}.key`);
  const certFile = path.join(dir, `${ip}.crt`);
  if (!fs.existsSync(certFile)) {
    fs.mkdirSync(dir, { recursive: true });
    const conf = path.join(dir, 'openssl.cnf');
    fs.writeFileSync(conf, [
      '[req]', 'distinguished_name=dn', 'x509_extensions=ext', 'prompt=no',
      '[dn]', 'CN=Personal Browser Remote',
      '[ext]', `subjectAltName=IP:${ip},IP:127.0.0.1,DNS:localhost`,
      'basicConstraints=CA:FALSE', 'keyUsage=digitalSignature,keyEncipherment', 'extendedKeyUsage=serverAuth',
    ].join('\n'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
      '-keyout', keyFile, '-out', certFile, '-config', conf], { stdio: 'ignore' });
  }
  return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sendUI = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);
const command = (name, data) => sendUI('command', { name, ...data });

// ---------- browser window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 600, minHeight: 400,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: '#f7f7f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'browser', 'index.html'));
  win.webContents.once('did-finish-load', broadcastStatus);
  win.on('closed', () => { win = null; guest = null; updateMirror(); });
}

// Lock down every <webview> (tab), and wire up each one.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (_ev, prefs) => {
    // Only our own preload: it gives built-in pages (history, new tab) a tiny message channel and nothing else.
    prefs.preload = path.join(__dirname, 'browser', 'internal-preload.js');
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
  });
  contents.on('did-attach-webview', (_ev, wc) => setupTab(wc));
});

function setupTab(wc) {
  // Links that want a new window open as a new tab instead.
  wc.setWindowOpenHandler(({ url, disposition }) => {
    sendUI('open-tab', { url, background: disposition === 'background-tab' });
    return { action: 'deny' };
  });
  const push = () => { if (wc === guest) broadcast({ type: 'state', ...pageState() }); };
  ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-stop-loading'].forEach((ev) => wc.on(ev, push));
  wc.on('context-menu', (_e, p) => pageContextMenu(wc, p));
  wc.on('destroyed', () => { if (guest === wc) { guest = null; updateMirror(); } });
}

// Right-click menu inside web pages (Edge-like basics).
function pageContextMenu(wc, p) {
  const h = wc.navigationHistory;
  const items = [];
  if (p.linkURL) {
    items.push(
      { label: 'Open Link in New Tab', click: () => sendUI('open-tab', { url: p.linkURL, background: true }) },
      { label: 'Copy Link', click: () => clipboard.writeText(p.linkURL) },
      { type: 'separator' });
  }
  if (p.mediaType === 'image' && p.srcURL) {
    items.push(
      { label: 'Open Image in New Tab', click: () => sendUI('open-tab', { url: p.srcURL, background: true }) },
      { label: 'Copy Image', click: () => wc.copyImageAt(p.x, p.y) },
      { type: 'separator' });
  }
  if (p.isEditable) {
    items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' });
  } else if (p.selectionText) {
    const q = p.selectionText.trim().slice(0, 80);
    items.push({ role: 'copy' },
      { label: `Search Google for “${q.length > 30 ? q.slice(0, 30) + '…' : q}”`,
        click: () => sendUI('open-tab', { url: 'https://www.google.com/search?q=' + encodeURIComponent(q) }) },
      { type: 'separator' });
  }
  items.push(
    { label: 'Back', enabled: h.canGoBack(), click: () => h.goBack() },
    { label: 'Forward', enabled: h.canGoForward(), click: () => h.goForward() },
    { label: 'Reload', click: () => wc.reload() },
    { type: 'separator' },
    { label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) });
  Menu.buildFromTemplate(items).popup({ window: win });
}

// Generic native menu for the browser UI (tab and favorite right-clicks).
ipcMain.handle('popup-menu', (_e, items) => new Promise((resolve) => {
  let chosen = null;
  const template = items.map((it) => it.type === 'separator' ? { type: 'separator' }
    : { label: it.label, enabled: it.enabled !== false, click: () => { chosen = it.id; } });
  Menu.buildFromTemplate(template).popup({ window: win, callback: () => setImmediate(() => resolve(chosen)) });
}));

ipcMain.on('view-size', (_e, { w, h }) => {
  view.w = w; view.h = h;
  cursor.x = clamp(cursor.x, 0, w); cursor.y = clamp(cursor.y, 0, h);
});

// The UI tells us which tab is in front; the remote and mirror follow it.
ipcMain.on('active-tab', (_e, id) => {
  const wc = webContents.fromId(id);
  if (!wc || wc === guest) return;
  guest = wc;
  updateMirror();
  broadcast({ type: 'state', ...pageState() });
});

function pageState() {
  if (!guest || guest.isDestroyed()) return { url: '', title: '', canBack: false, canForward: false };
  const h = guest.navigationHistory;
  const url = guest.getURL();
  const internal = url.startsWith(INTERNAL_BASE);
  const page = internal ? url.slice(INTERNAL_BASE.length).split(/[?#]/)[0] : '';
  return { url: internal ? '' : url, title: internal ? (INTERNAL_TITLES[page] || 'Browser') : guest.getTitle(),
    canBack: h.canGoBack(), canForward: h.canGoForward() };
}

// ---------- tab list for the phone ----------
let tabList = [];
ipcMain.on('tabs-update', (_e, list) => {
  tabList = Array.isArray(list) ? list : [];
  broadcast({ type: 'tabs', tabs: tabList });
});
let favList = [];
ipcMain.on('favorites-update', (_e, list) => {
  favList = Array.isArray(list) ? list : [];
  broadcast({ type: 'favorites', favorites: favList });
});

// ---------- site permissions ----------
// Electron grants everything by default; a real browser asks. Harmless ones pass, sensitive ones ask once per site.
const SAFE_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
const PERMISSION_NAMES = { media: 'use your camera/microphone', geolocation: 'know your location',
  notifications: 'show notifications', 'clipboard-read': 'read your clipboard', midi: 'use MIDI devices',
  midiSysex: 'use MIDI devices', 'display-capture': 'record your screen' };
const permissionChoices = new Map(); // "origin|permission" -> true/false (this run only)

function setupPermissions() {
  session.defaultSession.setPermissionRequestHandler(async (wc, permission, done, details) => {
    if (SAFE_PERMISSIONS.has(permission)) return done(true);
    if (!PERMISSION_NAMES[permission] || wc.getType() !== 'webview') return done(false);
    let origin = '';
    try { origin = new URL(details.requestingUrl || wc.getURL()).origin; } catch {}
    const key = `${origin}|${permission}`;
    if (permissionChoices.has(key)) return done(permissionChoices.get(key));
    const { response } = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Allow', 'Block'], defaultId: 1, cancelId: 1,
      message: `${origin.replace(/^https?:\/\//, '')} wants to ${PERMISSION_NAMES[permission]}`,
    });
    permissionChoices.set(key, response === 0);
    done(response === 0);
  });
  // Sites can also *check* a permission silently; answer truthfully instead of Electron's default "yes".
  // (Camera/mic: say "not blocked" so video-call sites still try — the real request then asks you.)
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => {
    const choice = permissionChoices.get(`${origin}|${permission}`);
    if (permission === 'media') return choice !== false;
    return SAFE_PERMISSIONS.has(permission) || choice === true;
  });
}

// ---------- downloads ----------
// Like Edge: files go straight to ~/Downloads, the downloads panel shows progress.
const downloads = [];  // newest first: { id, name, path, url, total, received, state, paused, time }
const liveItems = new Map(); // id -> DownloadItem (only while in progress)
let dlSeq = 0, dlPushTimer = null;
const downloadsFile = () => path.join(app.getPath('userData'), 'downloads.json');

function uniquePath(dir, name) {
  const ext = path.extname(name), base = path.basename(name, ext);
  let p = path.join(dir, name), n = 1;
  while (fs.existsSync(p) || downloads.some((d) => d.path === p && d.state === 'progressing')) {
    p = path.join(dir, `${base} (${n++})${ext}`);
  }
  return p;
}

function setupDownloads() {
  try {
    const saved = JSON.parse(fs.readFileSync(downloadsFile(), 'utf8'));
    for (const d of saved) downloads.push({ ...d, id: ++dlSeq });
  } catch {}

  session.defaultSession.on('will-download', (_e, item) => {
    const savePath = uniquePath(app.getPath('downloads'), item.getFilename() || 'download');
    item.setSavePath(savePath);
    const d = { id: ++dlSeq, name: path.basename(savePath), path: savePath, url: item.getURL(),
      total: item.getTotalBytes(), received: 0, state: 'progressing', paused: false, time: Date.now() };
    downloads.unshift(d);
    liveItems.set(d.id, item);
    item.on('updated', (_ev, state) => {
      d.received = item.getReceivedBytes();
      d.total = item.getTotalBytes();
      d.paused = item.isPaused();
      d.state = state === 'interrupted' ? 'interrupted' : 'progressing';
      pushDownloads();
    });
    item.once('done', (_ev, state) => {
      d.received = item.getReceivedBytes();
      d.state = state; // completed | cancelled | interrupted
      d.paused = false;
      liveItems.delete(d.id);
      if (state === 'completed' && process.platform === 'darwin') app.dock?.downloadFinished(d.path);
      pushDownloads(); saveDownloads();
    });
    pushDownloads({ open: true });
  });

  ipcMain.on('download-action', (_e, { id, action }) => {
    const d = downloads.find((x) => x.id === id);
    const item = liveItems.get(id);
    if (action === 'clear') {
      for (let i = downloads.length - 1; i >= 0; i--) if (downloads[i].state !== 'progressing') downloads.splice(i, 1);
    } else if (!d) return;
    else if (action === 'open') shell.openPath(d.path);
    else if (action === 'show') shell.showItemInFolder(d.path);
    else if (action === 'pause') item?.pause();
    else if (action === 'resume') item?.canResume() && item.resume();
    else if (action === 'cancel') item?.cancel();
    else if (action === 'retry') guest?.downloadURL(d.url);
    else if (action === 'remove') { if (d.state !== 'progressing') downloads.splice(downloads.indexOf(d), 1); }
    pushDownloads(); saveDownloads();
  });
  ipcMain.on('downloads-get', () => pushDownloads());
}

function pushDownloads({ open = false } = {}) {
  const send = () => {
    dlPushTimer = null;
    const list = downloads.slice(0, 100).map((d) => ({ ...d,
      missing: d.state === 'completed' && !fs.existsSync(d.path) }));
    sendUI('downloads', { list, open });
    // Dock icon progress bar while something downloads
    const live = downloads.filter((d) => d.state === 'progressing' && d.total > 0);
    const total = live.reduce((a, d) => a + d.total, 0), got = live.reduce((a, d) => a + d.received, 0);
    win?.setProgressBar(live.length ? got / total : -1);
  };
  if (open) { clearTimeout(dlPushTimer); return send(); }
  if (!dlPushTimer) dlPushTimer = setTimeout(send, 200);
}

function saveDownloads() {
  const done = downloads.filter((d) => d.state !== 'progressing').slice(0, 100)
    .map(({ id, ...rest }) => rest);
  try { fs.writeFileSync(downloadsFile(), JSON.stringify(done)); } catch {}
}

// ---------- app menu + shortcuts (work even when a web page has focus) ----------
function buildMenu() {
  const template = [
    { role: 'appMenu' },
    { label: 'File', submenu: [
      { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => command('new-tab') },
      { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: () => command('reopen-tab') },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => command('close-tab') },
      { type: 'separator' },
      { label: 'Open Location…', accelerator: 'CmdOrCtrl+L', click: () => command('focus-url') },
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' },
      { type: 'separator' },
      { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => command('find') },
      { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: () => command('find-next', { dir: 1 }) },
      { label: 'Find Previous', accelerator: 'CmdOrCtrl+Shift+G', click: () => command('find-next', { dir: -1 }) },
    ] },
    { label: 'View', submenu: [
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => command('reload') },
      { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => guest?.reloadIgnoringCache() },
      { type: 'separator' },
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => zoom(+0.5) },
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.5) },
      { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => guest?.setZoomLevel(0) },
      { type: 'separator' },
      { label: 'Show Favorites Bar', accelerator: 'CmdOrCtrl+Shift+B', click: () => command('toggle-favbar') },
      { label: 'Show Remote QR Code', accelerator: 'CmdOrCtrl+Shift+Q', click: () => command('toggle-qr') },
      { type: 'separator' },
      { label: 'Developer Tools (Page)', accelerator: 'Alt+CmdOrCtrl+I', click: () => guest?.toggleDevTools() },
      { label: 'Developer Tools (Browser UI)', click: () => win?.webContents.toggleDevTools() },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ] },
    { label: 'History', submenu: [
      { label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => command('back') },
      { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => command('forward') },
      { type: 'separator' },
      { label: 'Show All History', accelerator: 'CmdOrCtrl+Y', click: () => command('history') },
      { label: 'Downloads', accelerator: 'CmdOrCtrl+Shift+J', click: () => command('downloads') },
    ] },
    { label: 'Favorites', submenu: [
      { label: 'Add This Page to Favorites', accelerator: 'CmdOrCtrl+D', click: () => command('toggle-favorite') },
    ] },
    { label: 'Tabs', submenu: [
      { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => command('next-tab', { dir: 1 }) },
      { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => command('next-tab', { dir: -1 }) },
      { type: 'separator' },
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ label: `Tab ${n}`, accelerator: `CmdOrCtrl+${n}`, click: () => command('select-tab', { index: n - 1 }) })),
      { label: 'Last Tab', accelerator: 'CmdOrCtrl+9', click: () => command('select-tab', { index: -1 }) },
    ] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function zoom(step) {
  if (guest) guest.setZoomLevel(clamp(guest.getZoomLevel() + step, -4, 5));
}

// ---------- input injection ----------
function showCursor(click = false) {
  sendUI('cursor', { x: cursor.x, y: cursor.y, visible: true, click });
  clearTimeout(cursorHideTimer);
  cursorHideTimer = setTimeout(() => sendUI('cursor', { ...cursor, visible: false }), 5000);
}

function mouseMove(x, y) {
  guest?.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
}

function click(x, y) {
  if (!guest) return;
  x = Math.round(x); y = Math.round(y);
  guest.focus();
  guest.sendInputEvent({ type: 'mouseMove', x, y });
  guest.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  guest.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

function scroll(x, y, dx, dy) {
  if (!guest) return;
  // Remote sends finger movement (natural scrolling): finger up = negative = page scrolls down.
  guest.sendInputEvent({ type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaX: dx, deltaY: dy, canScroll: true });
}

const KEY_MAP = { Enter: 'Return', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Space: 'Space' };

function key(name) {
  if (!guest || !KEY_MAP[name]) return;
  const keyCode = KEY_MAP[name];
  guest.sendInputEvent({ type: 'keyDown', keyCode });
  if (name === 'Enter') guest.sendInputEvent({ type: 'char', keyCode: '\r' });
  if (name === 'Tab') guest.sendInputEvent({ type: 'char', keyCode: '\t' });
  guest.sendInputEvent({ type: 'keyUp', keyCode });
}

// ---------- mirror (advanced mode only) ----------
const mirror = { on: false, subscribed: null, latest: null, timer: null, lastSent: 0 };

function mirrorWanted() {
  for (const c of clients) if (c.mode === 'advanced') return true;
  return false;
}

function updateMirror() {
  const want = mirrorWanted() && !!guest && !guest.isDestroyed();
  if (want && !mirror.on) startMirror();
  else if (!want && mirror.on) stopMirror();
  else if (want && mirror.subscribed !== guest) { stopMirror(); startMirror(); } // tab switched
}

function startMirror() {
  mirror.on = true;
  mirror.subscribed = guest;
  // Frames only arrive when the page actually repaints — a still page costs nothing.
  guest.beginFrameSubscription(false, (image) => { mirror.latest = image; scheduleFrame(); });
  guest.capturePage().then((img) => { mirror.latest = img; scheduleFrame(); }).catch(() => {});
}

function stopMirror() {
  mirror.on = false;
  clearTimeout(mirror.timer); mirror.timer = null; mirror.latest = null;
  try { if (!mirror.subscribed?.isDestroyed()) mirror.subscribed?.endFrameSubscription(); } catch {}
  mirror.subscribed = null;
}

function scheduleFrame() {
  if (mirror.timer) return;
  const wait = Math.max(0, 1000 / MIRROR_FPS - (Date.now() - mirror.lastSent));
  mirror.timer = setTimeout(sendFrame, wait);
}

function sendFrame() {
  mirror.timer = null;
  const img = mirror.latest; mirror.latest = null;
  if (!img || !mirror.on || img.isEmpty()) return;
  mirror.lastSent = Date.now();
  // Scale retina frames down to page size: plenty sharp for a phone, ~4x less data.
  const sized = img.getSize().width > view.w ? img.resize({ width: Math.round(view.w), quality: 'good' }) : img;
  const jpeg = sized.toJPEG(60);
  for (const c of clients) {
    // Skip phones that are still busy receiving the previous frame (no lag pile-up).
    if (c.mode === 'advanced' && c.ws.readyState === 1 && c.ws.bufferedAmount < 256 * 1024) c.ws.send(jpeg);
  }
}

// ---------- remote server ----------
const clients = new Set();
let KEY = '';
let REMOTE_URL = '';
let QR_DATA = '';

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.ws.readyState === 1) c.ws.send(data);
}

function broadcastStatus() {
  sendUI('remote-status', { clients: clients.size, url: REMOTE_URL, qr: QR_DATA });
}

function handle(client, msg) {
  switch (msg.type) {
    case 'mode':
      client.mode = msg.mode === 'advanced' ? 'advanced' : 'basic';
      updateMirror();
      break;
    case 'nav': // go / back / forward / reload — acts on the active tab
      sendUI('navigate', { action: msg.action, input: msg.input });
      break;
    case 'move': // trackpad
      cursor.x = clamp(cursor.x + msg.dx, 0, view.w);
      cursor.y = clamp(cursor.y + msg.dy, 0, view.h);
      mouseMove(cursor.x, cursor.y);
      showCursor();
      break;
    case 'click': // trackpad tap
      click(cursor.x, cursor.y);
      showCursor(true);
      break;
    case 'scroll': // trackpad two-finger
      scroll(cursor.x, cursor.y, msg.dx, msg.dy);
      break;
    case 'tap': // mirror tap, normalized 0..1
      click(msg.x * view.w, msg.y * view.h);
      break;
    case 'mscroll': // mirror drag, normalized
      scroll(msg.x * view.w, msg.y * view.h, msg.dx * view.w, msg.dy * view.h);
      break;
    case 'text':
      guest?.insertText(String(msg.text || ''));
      break;
    case 'key':
      key(msg.key);
      break;
    case 'fav': // open / open-new / toggle — from the phone's favorites list
      command('remote-fav', { action: msg.action, url: typeof msg.url === 'string' ? msg.url : '' });
      break;
    case 'tab': // select / close / new — from the phone's tab list
      command('remote-tab', { action: msg.action, id: msg.id });
      break;
  }
}

function startServer() {
  KEY = remoteKey();
  const ip = lanIP();
  REMOTE_URL = `https://${ip}:${PORT}/?k=${KEY}`;
  const remoteHtml = path.join(__dirname, 'remote', 'index.html');

  const server = https.createServer(tlsCert(ip), (req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      fs.createReadStream(remoteHtml).pipe(res);
    } else {
      res.writeHead(404); res.end();
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const k = new URL(req.url, 'http://x').searchParams.get('k');
    if (k !== KEY) return ws.close(4001, 'bad key');
    const client = { ws, mode: 'basic' };
    clients.add(client);
    broadcastStatus();
    ws.send(JSON.stringify({ type: 'state', ...pageState() }));
    ws.send(JSON.stringify({ type: 'tabs', tabs: tabList }));
    ws.send(JSON.stringify({ type: 'favorites', favorites: favList }));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      try { handle(client, JSON.parse(data)); } catch {}
    });
    ws.on('close', () => {
      clients.delete(client);
      updateMirror();
      broadcastStatus();
    });
  });

  server.listen(PORT, '0.0.0.0', () => console.log('Remote:', REMOTE_URL));
  server.on('error', (err) => console.error('Remote server error:', err.message));
}

// ---------- boot ----------
app.whenReady().then(async () => {
  startServer();
  QR_DATA = await QRCode.toDataURL(REMOTE_URL, { margin: 1, width: 296, errorCorrectionLevel: 'M' });
  setupPermissions();
  setupDownloads();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
