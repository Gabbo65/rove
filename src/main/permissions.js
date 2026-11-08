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
}

module.exports = { attach, setTabCheck: (fn) => { isTab = fn; } };
