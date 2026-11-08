// Phone remote: HTTPS + WebSocket server the iPhone page connects to, input injection, and the mirror.
//
// NOTE: the security parts — remoteKey(), tlsCert(), and the key check in the WebSocket 'connection'
// handler — were moved here byte-for-byte from the old main.js and are intentionally left alone.
// Exception (approved 2026-11-08): tlsCert() now makes the certificate in-process instead of calling openssl,
// so the remote works on Windows. Same kind of certificate; the key check is unchanged.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { REMOTE_HTML } = require('./paths');
const favorites = require('./favorites');
const stream = require('./stream');

const PORT = process.env.PB_PORT !== undefined && process.env.PB_PORT !== '' ? Number(process.env.PB_PORT) : 8765; // tests use 0 = any free port
const MIRROR_FPS = 15;
const RTC_TIMEOUT = 8000; // no video connection after this → fall back to picture frames

let hub = null;
const cursor = { x: 600, y: 400 };         // trackpad cursor (page coords)

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
// Made once per address, then reused (an existing certificate is never replaced, so a phone that already
// trusts it keeps working). Built in-process — RSA 2048 key from Node's crypto, X.509 by node-forge —
// so it works on every system (an earlier version needed the openssl tool, which Windows doesn't have).
function tlsCert(ip) {
  const dir = path.join(app.getPath('userData'), 'tls');
  const keyFile = path.join(dir, `${ip}.key`);
  const certFile = path.join(dir, `${ip}.crt`);
  if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
    fs.mkdirSync(dir, { recursive: true });
    const forge = require('node-forge');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const cert = forge.pki.createCertificate();
    cert.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }));
    cert.serialNumber = '01' + crypto.randomBytes(15).toString('hex'); // positive, random
    cert.validity.notBefore = new Date(Date.now() - 60_000);
    cert.validity.notAfter = new Date(Date.now() + 825 * 24 * 3600_000);
    const subject = [{ name: 'commonName', value: 'Rove Remote' }];
    cert.setSubject(subject);
    cert.setIssuer(subject);
    cert.setExtensions([
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 7, ip }, { type: 7, ip: '127.0.0.1' }, { type: 2, value: 'localhost' }] },
      { name: 'subjectKeyIdentifier' },
    ]);
    cert.sign(forge.pki.privateKeyFromPem(keyPem), forge.md.sha256.create());
    fs.writeFileSync(keyFile, keyPem, { mode: 0o600 });
    fs.writeFileSync(certFile, forge.pki.certificateToPem(cert));
  }
  return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- what the phone drives: the current window's active tab ----------
function target() {
  const win = hub?.current();
  return { win, tab: win?.active || null, wc: win?.active?.wc || null };
}
const viewSize = () => {
  const c = target().win?.content;
  return { w: c?.width || 1200, h: c?.height || 800 };
};

function pageState() {
  const { tab } = target();
  if (!tab) return { url: '', title: '', canBack: false, canForward: false };
  const s = tab.state();
  return { url: s.url, title: s.title, canBack: s.canBack, canForward: s.canForward };
}

function tabList() {
  const { win } = target();
  if (!win) return [];
  return win.tabs.map((t) => {
    const s = t.state();
    return { id: s.id, title: s.title, url: s.url, favicon: s.favicon, active: t === win.active, pinned: s.pinned, asleep: s.asleep };
  });
}

function favList() {
  return favorites.list().map(({ url, title, favicon }) => ({ url, title, favicon }));
}

// ---------- input injection ----------
function showCursor(click = false) {
  target().win?.showCursor(cursor.x, cursor.y, click);
}

function mouseMove(x, y) {
  target().wc?.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
}

function click(x, y) {
  const guest = target().wc;
  if (!guest) return;
  x = Math.round(x); y = Math.round(y);
  guest.focus();
  guest.sendInputEvent({ type: 'mouseMove', x, y });
  guest.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  guest.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

function scroll(x, y, dx, dy) {
  const guest = target().wc;
  if (!guest) return;
  // Remote sends finger movement (natural scrolling): finger up = negative = page scrolls down.
  guest.sendInputEvent({ type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaX: dx, deltaY: dy, canScroll: true });
}

const KEY_MAP = { Enter: 'Return', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Space: 'Space' };

function key(name) {
  const guest = target().wc;
  if (!guest || !KEY_MAP[name]) return;
  const keyCode = KEY_MAP[name];
  guest.sendInputEvent({ type: 'keyDown', keyCode });
  if (name === 'Enter') guest.sendInputEvent({ type: 'char', keyCode: '\r' });
  if (name === 'Tab') guest.sendInputEvent({ type: 'char', keyCode: '\t' });
  guest.sendInputEvent({ type: 'keyUp', keyCode });
}

// ---------- mirror ----------
// Preferred: live video (WebRTC) of the tab — smooth, low data. Fallback: JPEG frames over the WebSocket
// for phones where the video connection can't be made. Either way it only runs while a phone shows Advanced.
const mirror = { on: false, subscribed: null, latest: null, timer: null, lastSent: 0 };

// Phones that need JPEG frames: in Advanced and not (or no longer) on video.
function jpegClients() {
  return [...clients].filter((c) => c.mode === 'advanced' && c.rtc !== 'connected' && c.rtc !== 'pending');
}

function updateMirror() {
  const guest = target().wc;
  // Video: start for new Advanced phones, follow tab switches, stop when nobody watches.
  const videoClients = [...clients].filter((c) => c.mode === 'advanced' && (c.rtc === 'pending' || c.rtc === 'connected'));
  stream.setSource(videoClients.length ? guest : null);
  // Pictures
  const want = jpegClients().length > 0 && !!guest && !guest.isDestroyed();
  if (want && !mirror.on) startMirror(guest);
  else if (!want && mirror.on) stopMirror();
  else if (want && mirror.subscribed !== guest) { stopMirror(); startMirror(guest); } // tab switched
}

function startMirror(guest) {
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
  const { w } = viewSize();
  const sized = img.getSize().width > w ? img.resize({ width: Math.round(w), quality: 'good' }) : img;
  const jpeg = sized.toJPEG(60);
  for (const c of jpegClients()) {
    // Skip phones that are still busy receiving the previous frame (no lag pile-up).
    if (c.ws.readyState === 1 && c.ws.bufferedAmount < 256 * 1024) c.ws.send(jpeg);
  }
}

// Video connection setup for one phone.
function startVideo(client) {
  client.rtc = 'pending';
  clearTimeout(client.rtcTimer);
  client.rtcTimer = setTimeout(() => { if (client.rtc === 'pending') videoFailed(client); }, RTC_TIMEOUT);
  updateMirror();
  stream.open(client.id, (msg) => (msg.kind === 'error' ? videoFailed(client) : send(client, { type: 'rtc', ...msg })))
    .catch(() => videoFailed(client));
}
function videoFailed(client) {
  clearTimeout(client.rtcTimer);
  client.rtc = 'failed';
  stream.close(client.id);
  send(client, { type: 'rtc', kind: 'close' });
  updateMirror();
}
function stopVideo(client) {
  clearTimeout(client.rtcTimer);
  if (client.rtc === 'pending' || client.rtc === 'connected') stream.close(client.id);
  client.rtc = client.rtc === 'failed' ? 'failed' : null;
}

// ---------- remote server ----------
const clients = new Set();
let clientSeq = 0;
let KEY = '';
let REMOTE_URL = '';
let QR_DATA = '';

function send(client, msg) {
  if (client.ws.readyState === 1) client.ws.send(JSON.stringify(msg));
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.ws.readyState === 1) c.ws.send(data);
}

function status() { return { clients: clients.size, url: REMOTE_URL, qr: QR_DATA }; }

function broadcastStatus(clientsChanged = false) {
  hub?.onRemoteStatus(status(), { clientsChanged });
}

function handle(client, msg) {
  const { win } = target();
  const { w, h } = viewSize();
  switch (msg.type) {
    case 'mode': {
      const mode = msg.mode === 'advanced' ? 'advanced' : 'basic';
      const was = client.mode;
      client.mode = mode;
      if (mode === 'advanced' && was !== 'advanced' && msg.rtc && client.rtc !== 'failed') startVideo(client);
      if (mode !== 'advanced') stopVideo(client);
      updateMirror();
      break;
    }
    case 'rtc': // video connection messages from the phone
      if (msg.kind === 'answer' || msg.kind === 'ice') stream.signal(client.id, msg);
      else if (msg.kind === 'connected') { clearTimeout(client.rtcTimer); client.rtc = 'connected'; updateMirror(); }
      else if (msg.kind === 'failed') videoFailed(client);
      break;
    case 'nav': // go / back / forward / reload — acts on the active tab
      if (!win) break;
      if (msg.action === 'go') win.navigate(String(msg.input || ''), { typed: true });
      else if (msg.action === 'back') win.active?.back();
      else if (msg.action === 'forward') win.active?.forward();
      else if (msg.action === 'reload') win.active?.reload();
      break;
    case 'move': // trackpad
      cursor.x = clamp(cursor.x + msg.dx, 0, w);
      cursor.y = clamp(cursor.y + msg.dy, 0, h);
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
      click(msg.x * w, msg.y * h);
      break;
    case 'mscroll': // mirror drag, normalized
      scroll(msg.x * w, msg.y * h, msg.dx * w, msg.dy * h);
      break;
    case 'text':
      target().wc?.insertText(String(msg.text || ''));
      break;
    case 'key':
      key(msg.key);
      break;
    case 'fav': { // open / open-new / toggle — from the phone's favorites list
      if (!win) break;
      const url = typeof msg.url === 'string' ? msg.url : '';
      if (msg.action === 'open' && /^https?:|^file:/i.test(url)) win.navigate(url);
      else if (msg.action === 'open-new' && /^https?:|^file:/i.test(url)) win.newTab(url);
      else if (msg.action === 'toggle') hub.toggleFavorite?.(win, { fromPhone: true });
      break;
    }
    case 'tab': { // select / close / new — from the phone's tab list
      if (!win) break;
      const t = win.tab(msg.id);
      if (msg.action === 'new') win.newTab();
      else if (t && msg.action === 'select') win.activate(t);
      else if (t && msg.action === 'close') win.close(t);
      break;
    }
  }
}

async function start(theHub) {
  hub = theHub;
  KEY = remoteKey();
  const ip = lanIP();
  const remoteHtml = REMOTE_HTML;

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
    const client = { ws, mode: 'basic', id: ++clientSeq, rtc: null };
    clients.add(client);
    broadcastStatus(true);
    ws.send(JSON.stringify({ type: 'state', ...pageState() }));
    ws.send(JSON.stringify({ type: 'tabs', tabs: tabList() }));
    ws.send(JSON.stringify({ type: 'favorites', favorites: favList() }));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      try { handle(client, JSON.parse(data)); } catch {}
    });
    ws.on('close', () => {
      stopVideo(client);
      clients.delete(client);
      updateMirror();
      broadcastStatus(true);
    });
  });

  await new Promise((resolve) => {
    server.on('error', (err) => { console.error('Remote server error:', err.message); resolve(); });
    server.listen(PORT, '0.0.0.0', () => resolve());
  });
  const port = server.address()?.port || PORT;
  REMOTE_URL = `https://${ip}:${port}/?k=${KEY}`;
  QR_DATA = await QRCode.toDataURL(REMOTE_URL, { margin: 1, width: 296, errorCorrectionLevel: 'M' });
  console.log('Remote:', REMOTE_URL);
  broadcastStatus();
  return server;
}

// ---------- the browser tells us what changed ----------
let stateTimer = null, tabsTimer = null;
module.exports = {
  start,
  status,
  port: () => { try { return Number(new URL(REMOTE_URL).port); } catch { return PORT; } },
  stateChanged() {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(() => broadcast({ type: 'state', ...pageState() }), 50);
  },
  tabsChanged() {
    clearTimeout(tabsTimer);
    tabsTimer = setTimeout(() => { broadcast({ type: 'tabs', tabs: tabList() }); broadcast({ type: 'state', ...pageState() }); }, 80);
  },
  favoritesChanged() { broadcast({ type: 'favorites', favorites: favList() }); },
  targetChanged() { updateMirror(); module.exports.tabsChanged(); },
  _clients: clients, // tests
};
