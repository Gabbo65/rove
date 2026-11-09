// Site permissions. Electron grants everything by default; a real browser asks.
// Harmless ones pass, sensitive ones ask once per site (per run), anything unknown is refused.
const { dialog, BaseWindow } = require('electron');

const SAFE_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
const PERMISSION_NAMES = { media: 'use your camera/microphone', geolocation: 'know your location',
  notifications: 'show notifications', 'clipboard-read': 'read your clipboard', midi: 'use MIDI devices',
  midiSysex: 'use MIDI devices', 'display-capture': 'record your screen' };

let isTab = () => false; // set by app.js: only page tabs may ask (not our UI)

const attached = new WeakSet();
function attach(ses) {
  if (attached.has(ses)) return;
  attached.add(ses);
  const choices = new Map(); // "origin|permission" -> true/false (per session, per run)

  ses.setPermissionRequestHandler(async (wc, permission, done, details) => {
    if (SAFE_PERMISSIONS.has(permission)) return done(true);
    if (permission === 'openExternal') return done(await askExternal(wc, details, choices));
    if (!PERMISSION_NAMES[permission] || !isTab(wc)) return done(false);
    let origin = '';
    try { origin = new URL(details.requestingUrl || wc.getURL()).origin; } catch {}
    const key = `${origin}|${permission}`;
    if (choices.has(key)) return done(choices.get(key));
    const parent = BaseWindow.getFocusedWindow() || undefined;
    const opts = { type: 'question', buttons: ['Allow', 'Block'], defaultId: 1, cancelId: 1,
      message: `${origin.replace(/^https?:\/\//, '')} wants to ${PERMISSION_NAMES[permission]}` };
    const { response } = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
    choices.set(key, response === 0);
    done(response === 0);
  });
  // Sites can also *check* a permission silently; answer truthfully instead of Electron's default "yes".
  // (Camera/mic: say "not blocked" so video-call sites still try — the real request then asks you.)
  ses.setPermissionCheckHandler((_wc, permission, origin) => {
    const choice = choices.get(`${origin}|${permission}`);
    if (permission === 'media') return choice !== false;
    return SAFE_PERMISSIONS.has(permission) || choice === true;
  });
  // USB / serial / HID devices: we have no device chooser, so pages never get one (Electron would otherwise
  // let a page pick a device without asking you).
  ses.setDevicePermissionHandler(() => false);
  ses.on('select-hid-device', (e, _details, callback) => { e.preventDefault(); callback(''); });
  ses.on('select-usb-device', (e, _details, callback) => { e.preventDefault(); callback(''); });
  ses.on('select-serial-port', (e, _ports, _wc, callback) => { e.preventDefault(); callback(''); });
}

// Links that open another app (mailto:, zoommtg:, ms-teams:, …): ask first, like other browsers.
// The answer is remembered per site + kind of link for this run; while a question is open, repeats wait for it.
async function askExternal(wc, details, choices) {
  if (!isTab(wc)) return false;
  let origin = '', scheme = '', target = String(details?.externalURL || '');
  try { origin = new URL(details.requestingUrl || wc.getURL()).origin; } catch {}
  try { scheme = new URL(target).protocol.replace(/:$/, '').toLowerCase(); } catch { return false; }
  if (!scheme || ['javascript', 'file', 'pb', 'data', 'blob'].includes(scheme)) return false;
  const key = `${origin}|openExternal:${scheme}`;
  if (choices.has(key)) return choices.get(key);
  const site = origin.replace(/^https?:\/\//, '') || 'This page';
  const shown = target.length > 120 ? `${target.slice(0, 117)}…` : target;
  const ask = (async () => {
    const parent = BaseWindow.getFocusedWindow() || undefined;
    const opts = { type: 'question', buttons: ['Open', 'Cancel'], defaultId: 1, cancelId: 1,
      message: `${site} wants to open a “${scheme}:” link in another app`, detail: shown };
    const { response } = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
    return response === 0;
  })();
  choices.set(key, ask);
  const ok = await ask;
  choices.set(key, ok);
  return ok;
}

module.exports = { attach, setTabCheck: (fn) => { isTab = fn; } };
