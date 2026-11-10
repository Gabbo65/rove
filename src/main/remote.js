// Phone remote: HTTPS + WebSocket server the phone page connects to, input injection, and the mirror.
//
// Security (hardened in 0.1.2, approved by the owner 2026-11-09):
//  • Secret link: a 128-bit key in the QR code, compared in constant time. Too many wrong keys from one
//    address → that address is refused for a while.
//  • Pairing: a NEW phone with the right key still has to be allowed on the computer ("Allow / Don't allow").
//    An allowed phone gets its own device token and reconnects without asking. Phones can be removed in
//    Settings, and "new link" changes the key and forgets every phone.
//  • Only the phone page itself may connect (Origin check), messages are size-limited, a few phones at most.
//  • The phone can only open web addresses (http/https) — never local files.
//  • Can be turned off completely in Settings (nothing listens then).
//  • Certificate: self-made per Wi-Fi address, in-process (node-forge), private key file readable only by you.
const { app, dialog, BaseWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const net = require('net');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { REMOTE_HTML } = require('./paths');
const favorites = require('./favorites');
const stream = require('./stream');
const urls = require('./urls');
const settings = require('./settings');

const PORT = process.env.PB_PORT !== undefined && process.env.PB_PORT !== '' ? Number(process.env.PB_PORT) : 8765; // tests use 0 = any free port
const MIRROR_FPS = 15;
const RTC_TIMEOUT = 8000; // no video connection after this → fall back to picture frames
const MAX_CLIENTS = 6;
const MAX_MESSAGE = 256 * 1024;            // biggest phone message (video setup) is a few KB
const FAIL_LIMIT = 10, FAIL_WINDOW = 10 * 60_000, BLOCK_FOR = 10 * 60_000, DENIED_BLOCK = 60_000;
const TEST = !!process.env.PB_TEST;

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

// ---------- secret link + paired phones (remote.json, readable only by you) ----------
// { key: 32 hex chars, devices: [{ id, token, name, added, lastSeen }] }
const storeFile = () => path.join(app.getPath('userData'), 'remote.json');
let store = null;
function loadStore() {
  if (store) return store;
  let data = {};
  try { data = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) || {}; } catch {}
  store = { key: data.key, devices: Array.isArray(data.devices) ? data.devices : [] };
  if (!/^[0-9a-f]{32}$/.test(store.key || '')) { store.key = crypto.randomBytes(16).toString('hex'); store.devices = []; saveStore(); }
  return store;
}
function saveStore() {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch {}
}
// Constant-time comparison: how long a check takes says nothing about how close a guess was.
function sameSecret(a, b) {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
const deviceFor = (token) => (token ? loadStore().devices.find((d) => sameSecret(d.token, token)) || null : null);

function deviceName(ua = '') {
  const what = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone'
    : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux device' : 'Device';
  const browser = /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? `${what} · ${browser}` : what;
}

// ---------- too many wrong tries → that address waits ----------
const tries = new Map(); // ip -> { n, first, until }
function blocked(ip) { const t = tries.get(ip); return !!t && t.until > Date.now(); }
function failed(ip, { denied = false } = {}) {
  const now = Date.now();
  let t = tries.get(ip);
  if (!t || now - t.first > FAIL_WINDOW) t = { n: 0, first: now, until: 0 };
  t.n++;
  if (denied) t.until = now + DENIED_BLOCK;
  else if (t.n >= FAIL_LIMIT) t.until = now + BLOCK_FOR;
  tries.set(ip, t);
}

// Self-signed HTTPS certificate for the current Wi-Fi address (iPhone Safari may refuse plain HTTP).
// Made once per address, then reused (an existing certificate is never replaced, so a phone that already
// trusts it keeps working). Built in-process — RSA 2048 key from Node's crypto, X.509 by node-forge —
// so it works on every system (an earlier version needed the openssl tool, which Windows doesn't have).
function tlsCert(ip) {
  const dir = path.join(app.getPath('userData'), 'tls');
  const keyFile = path.join(dir, `${ip}.key`);
  const certFile = path.join(dir, `${ip}.crt`);
  try { return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }; } catch {} // made earlier: reuse it
  {
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
    const certPem = forge.pki.certificateToPem(cert);
    fs.writeFileSync(keyFile, keyPem, { mode: 0o600 });
    fs.writeFileSync(certFile, certPem);
    return { key: Buffer.from(keyPem), cert: Buffer.from(certPem) };
  }
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
let REMOTE_URL = '';
let QR_DATA = '';

function send(client, msg) {
  if (client.ws.readyState === 1) client.ws.send(JSON.stringify(msg));
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.ws.readyState === 1) c.ws.send(data);
}

function status() {
  if (!enabled) return { clients: 0, url: '', qr: '', offline: false, disabled: true };
  return { clients: clients.size, url: REMOTE_URL, qr: QR_DATA, offline: currentIP === '127.0.0.1', disabled: false };
}

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
      if (msg.action === 'go') {
        const url = urls.fromInput(String(msg.input || '').slice(0, 4000));
        if (url && /^https?:/i.test(url)) win.navigate(url, { typed: true }); // web addresses only, never local files
      }
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
      target().wc?.insertText(String(msg.text || '').slice(0, 10_000));
      break;
    case 'key':
      key(msg.key);
      break;
    case 'fav': { // open / open-new / toggle — from the phone's favorites list
      if (!win) break;
      const url = typeof msg.url === 'string' ? msg.url : '';
      if (msg.action === 'open' && /^https?:/i.test(url)) win.navigate(url);
      else if (msg.action === 'open-new' && /^https?:/i.test(url)) win.newTab(url);
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

// A new phone (right key, no device token yet) must be allowed on the computer.
async function askToAllow({ ip, name }) {
  if (module.exports._approve) return module.exports._approve({ ip, name });
  if (TEST) return true;
  const parent = BaseWindow.getFocusedWindow() || hub?.current()?.base;
  parent?.focus?.();
  const opts = { type: 'question', buttons: ['Allow', 'Don’t allow'], defaultId: 1, cancelId: 1,
    message: 'A phone wants to control Rove',
    detail: `${name} at ${ip.replace(/^::ffff:/, '')}\n\nOnly allow it if it’s your own phone and you just scanned the QR code. `
      + 'You can remove paired phones in Settings → Phone remote.' };
  const { response } = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
  return response === 0;
}
const asking = new Set(); // addresses with a question open

const sockets = new Set(); // every raw connection, so turning the remote off drops them all at once
let server = null, front = null, wss = null, enabled = false, port = PORT;

function admit(ws, device) {
  const client = { ws, mode: 'basic', id: ++clientSeq, rtc: null, device: device.id };
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
}

async function onConnection(ws, req) {
  const ip = req.socket.remoteAddress || '';
  ws.on('error', () => {});
  if (blocked(ip)) return ws.close(4029, 'too many tries');
  const origin = req.headers.origin;
  if (origin && origin !== `https://${req.headers.host}`) return ws.close(4003, 'not allowed'); // only our own phone page
  if (clients.size >= MAX_CLIENTS) return ws.close(4008, 'too many phones');
  const q = new URL(req.url, 'http://x').searchParams;
  if (!sameSecret(q.get('k'), loadStore().key)) { failed(ip); return ws.close(4001, 'bad key'); }
  let device = deviceFor(q.get('d'));
  if (!device) {
    if (asking.has(ip)) return ws.close(4002, 'waiting');
    asking.add(ip);
    let ok = false;
    try {
      ws.send(JSON.stringify({ type: 'pending' }));
      ok = await askToAllow({ ip, name: deviceName(req.headers['user-agent']) });
    } finally { asking.delete(ip); }
    if (ws.readyState !== 1) return;
    if (!ok) { failed(ip, { denied: true }); return ws.close(4003, 'not allowed'); }
    device = { id: crypto.randomBytes(6).toString('hex'), token: crypto.randomBytes(16).toString('hex'),
      name: deviceName(req.headers['user-agent']), added: Date.now(), lastSeen: Date.now() };
    loadStore().devices.push(device);
    saveStore();
    ws.send(JSON.stringify({ type: 'paired', token: device.token }));
    hub?.toPages?.('settings', 'remote-changed');
  } else if (Date.now() - (device.lastSeen || 0) > 60_000) {
    device.lastSeen = Date.now();
    saveStore();
  }
  tries.delete(ip);
  admit(ws, device);
}

async function start(theHub) {
  hub = theHub;
  loadStore();
  const remoteHtml = REMOTE_HTML;
  server = https.createServer(tlsCert(lanIP()), (req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' });
      fs.createReadStream(remoteHtml).pipe(res);
    } else {
      res.writeHead(404); res.end();
    }
  });
  server.on('error', (err) => console.error('Remote server error:', err.message));
  // One port, two kinds of visitors: TLS goes to the HTTPS server; plain http:// (typed by hand, old bookmark)
  // gets sent to the https:// address instead of a dropped connection ("network connection was lost").
  front = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => {});
    sock.setTimeout(10_000, () => sock.destroy());
    sock.once('data', (buf) => {
      sock.setTimeout(0);
      if (buf[0] === 0x16) { sock.pause(); sock.unshift(buf); server.emit('connection', sock); return; } // TLS handshake
      const m = /^[A-Z]{3,7} (\/[^\s]*) HTTP\/1\.[01]\r?\n/.exec(buf.toString('latin1', 0, 4096));
      const loc = `https://${currentIP || lanIP()}:${port}${m ? m[1] : '/'}`; // our own address only, never the Host header
      sock.end(`HTTP/1.1 301 Moved Permanently\r\nLocation: ${loc}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
    });
  });
  front.on('error', (err) => console.error('Remote server error:', err.message));
  wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE });
  wss.on('connection', (ws, req) => { onConnection(ws, req).catch(() => { try { ws.close(1011); } catch {} }); });
  settings.on('change', (changed) => { if ('remoteEnabled' in changed) setEnabled(changed.remoteEnabled).catch(() => {}); });
  await setEnabled(settings.get('remoteEnabled') !== false);
  return server;
}

// Turn the whole server on (listening on the Wi-Fi) or off (nothing listens, phones are disconnected).
async function setEnabled(on) {
  if (on === enabled) return;
  enabled = on;
  clearInterval(addressTimer);
  if (!on) {
    for (const c of [...clients]) c.ws.close(4000, 'remote turned off');
    await new Promise((resolve) => { front.close(() => resolve()); for (const x of sockets) x.destroy(); setTimeout(resolve, 1000); });
    currentIP = null; REMOTE_URL = ''; QR_DATA = '';
    broadcastStatus(true);
    return;
  }
  const ip = lanIP();
  try { server.setSecureContext(tlsCert(ip)); } catch {}
  await new Promise((resolve, reject) => {
    const fail = (err) => { front.off('listening', ok); enabled = false; reject(err); };
    const ok = () => { front.off('error', fail); resolve(); };
    front.once('error', fail);
    front.once('listening', ok);
    front.listen(PORT, '0.0.0.0');
  });
  port = front.address()?.port || PORT;
  await setAddress(ip, port);
  // The Wi-Fi address can change while the browser runs (started offline, moved to another network…):
  // check every few seconds and, if it changed, switch the certificate, the link and the QR code.
  addressTimer = setInterval(() => { checkAddress().catch(() => {}); }, 5000);
  addressTimer.unref?.();
}

async function checkAddress() {
  if (!enabled) return false;
  const now = lanIP();
  if (now === currentIP) return false;
  try { server.setSecureContext(tlsCert(now)); } catch (err) { console.error('Remote certificate update failed:', err.message); return false; }
  await setAddress(now, port);
  return true;
}

let currentIP = null, addressTimer = null;
async function setAddress(ip, thePort) {
  currentIP = ip;
  REMOTE_URL = `https://${ip}:${thePort}/?k=${loadStore().key}`;
  QR_DATA = await QRCode.toDataURL(REMOTE_URL, { margin: 1, width: 296, errorCorrectionLevel: 'M' });
  if (TEST) console.log('Remote:', REMOTE_URL);
  broadcastStatus();
}

// ---------- paired phones (Settings → Phone remote) ----------
function info() {
  const connected = new Set([...clients].map((c) => c.device));
  return { enabled, devices: loadStore().devices.map(({ id, name, added, lastSeen }) => ({ id, name, added, lastSeen, connected: connected.has(id) })) };
}
function dropClients(test) { for (const c of [...clients]) if (test(c)) c.ws.close(4001, 'forgotten'); }
function forgetDevice(id) {
  const s = loadStore();
  s.devices = s.devices.filter((d) => d.id !== String(id));
  saveStore();
  dropClients((c) => c.device === String(id));
  hub?.toPages?.('settings', 'remote-changed');
  return info();
}
// New secret link: every phone is forgotten and has to scan the new QR code (and be allowed) again.
async function newLink() {
  const s = loadStore();
  s.key = crypto.randomBytes(16).toString('hex');
  s.devices = [];
  saveStore();
  dropClients(() => true);
  if (enabled && currentIP) await setAddress(currentIP, port);
  hub?.toPages?.('settings', 'remote-changed');
  return info();
}

// ---------- the browser tells us what changed ----------
let stateTimer = null, tabsTimer = null;
module.exports = {
  start,
  status,
  info,
  forgetDevice,
  newLink,
  setEnabled,
  checkAddress: () => checkAddress(),
  port: () => port,
  _approve: null,                         // tests: replace the "Allow this phone?" question
  _resetLimits: () => tries.clear(),      // tests
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
