// Live video of the active tab for the phone's Advanced mode (WebRTC).
// A hidden "streamer" page captures the tab and sends it as a video track; signalling goes through the
// phone's existing WebSocket. Capture: the page calls getDisplayMedia() and we answer with the tab's frame
// (Electron's tab capture — no screen-recording permission, only that one page is captured).
const { BrowserWindow, session, ipcMain, webContents } = require('electron');
const { PRELOAD } = require('./paths');
const protocolMod = require('./protocol');

let win = null;
let ready = null;
let source = null;              // webContents being captured
const peers = new Map();        // phone client id -> send(msg) to that phone
let idleTimer = null;

function ensure() {
  clearTimeout(idleTimer);
  if (win && !win.isDestroyed()) return ready;
  const ses = session.fromPartition('pb-streamer');
  protocolMod.handleSession(ses);
  // The streamer page may capture (the handler below decides WHAT); nothing else is allowed.
  const isStreamer = (wc) => !!win && wc === win.webContents;
  ses.setPermissionRequestHandler((wc, permission, done) => done(isStreamer(wc) && permission === 'display-capture'));
  ses.setPermissionCheckHandler((wc, permission) => isStreamer(wc) && permission === 'display-capture');
  ses.setDisplayMediaRequestHandler((request, callback) => {
    // Only our own hidden streamer page may capture, and only the tab we chose.
    const ok = !!win && !!request.frame && webContents.fromFrame(request.frame) === win.webContents;
    if (!ok || !source || source.isDestroyed()) return callback({});
    callback({ video: source.mainFrame });
  });
  win = new BrowserWindow({
    show: false, width: 200, height: 120, skipTaskbar: true,
    webPreferences: { session: ses, preload: PRELOAD.streamer, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.on('closed', () => { win = null; ready = null; });
  ready = win.loadURL('pb://streamer/index.html');
  return ready;
}

// Each tab switch gets a new number so the streamer knows to capture again.
let sourceSeq = 0;
function sourceId() {
  if (!win || !source || source.isDestroyed()) return null;
  return `${source.id}:${sourceSeq}`;
}

// Capturing needs a user gesture in Chromium; calls made this way count as one (our own hidden page only).
function run(fn, arg) {
  return win.webContents.executeJavaScript(`window.${fn}(${JSON.stringify(arg)})`, true).catch(() => {});
}

ipcMain.on('streamer:signal', (e, clientId, msg) => {
  if (!win || e.sender !== win.webContents) return;
  peers.get(clientId)?.(msg);
});

module.exports = {
  // Start video for one phone. send(msg) delivers offer/ICE (or {kind:'error'}) to that phone.
  async open(clientId, send) {
    await ensure();
    peers.set(clientId, send);
    const id = sourceId();
    if (!id) { send({ kind: 'error', reason: 'no-source' }); return; }
    run('pbOpen', { clientId, sourceId: id });
  },
  signal(clientId, msg) {
    if (win && peers.has(clientId)) win.webContents.send('streamer:signal', { clientId, msg });
  },
  close(clientId) {
    if (!peers.delete(clientId)) return;
    if (win) win.webContents.send('streamer:close', clientId);
    if (!peers.size) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { if (!peers.size && win) win.destroy(); }, 30_000);
    }
  },
  // The tab to capture (null = nobody watching). Running videos switch to the new tab.
  setSource(wc) {
    if (wc === source) return;
    source = wc || null;
    sourceSeq++;
    if (!win || !peers.size) return;
    const id = sourceId();
    if (id) run('pbSource', id);
  },
  _peers: peers,
};
