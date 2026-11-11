// Hex: Rove's built-in toolkit. ONE core lives here in the main process; the radial wheel (and later the
// Extract window) are only views of it. Items are registered by id; views can only ask to run an id —
// they never send code or functions, and every request is checked here.
const { screen } = require('electron');

// The four families, in wheel order (top-left, top-right, bottom-left, bottom-right).
const FAMILIES = [
  { id: 'injector', name: 'Injector', hint: 'Your scripts', empty: '' },
  { id: 'magic', name: 'Magic', hint: 'Tools',
    empty: 'Tools like Cinema, Scanner, Reader and Protection arrive in the next Hex updates.' },
  { id: 'options', name: 'Settings', hint: 'Hex options', empty: '' },
  { id: 'extract', name: 'Extract', hint: 'Hex window',
    empty: 'The detached Hex window comes in a later Hex update.' },
];
const FAMILY_IDS = new Set(FAMILIES.map((f) => f.id));
const ID = /^[a-z0-9][a-z0-9.-]{0,63}$/;

const items = new Map(); // id -> { id, family, parent, kind, name, description, icon, color, empty, run }
// kinds: 'run' (runs in the main process) · 'group' (opens a deeper ring) · 'key' (the wheel records a shortcut)
const KINDS = new Set(['run', 'group', 'key']);

// First-party registration. (Third-party tools will go through a separate, permission-checked path later.)
function register(item) {
  const kind = item?.kind || 'run';
  if (!item || !ID.test(item.id || '') || !FAMILY_IDS.has(item.family) || !KINDS.has(kind)
    || (kind === 'run' && typeof item.run !== 'function') || (item.parent && items.get(item.parent)?.kind !== 'group')) {
    throw new Error(`Hex: bad item ${item && item.id}`);
  }
  if (items.has(item.id)) throw new Error(`Hex: duplicate item ${item.id}`);
  items.set(item.id, { id: item.id, family: item.family, parent: item.parent || null, kind, name: String(item.name || item.id),
    description: String(item.description || ''), icon: item.icon || '', color: /^#[0-9a-f]{6}$/i.test(item.color || '') ? item.color : '',
    empty: String(item.empty || ''), run: item.run || null, current: item.current || null, stay: !!item.stay });
  return () => items.delete(item.id);
}

// Providers add items that change at runtime (e.g. the user's scripts): nodes() returns plain tree nodes,
// run(win, id) runs one of their ids.
const providers = []; // { family, prefix, nodes(), run(ctx, id) }
function provide(p) {
  if (!FAMILY_IDS.has(p.family) || !/^[a-z]+\.$/.test(p.prefix) || typeof p.nodes !== 'function' || typeof p.run !== 'function') {
    throw new Error('Hex: bad provider');
  }
  providers.push(p);
}

// What a view may see: plain data only (a tree: families → items → deeper groups).
function node(i) {
  const kids = [...items.values()].filter((c) => c.parent === i.id).map(node);
  return { id: i.id, kind: i.kind, name: i.name, description: i.description, icon: i.icon, color: i.color, empty: i.empty,
    on: i.current ? !!i.current() : false, ...(i.kind === 'group' ? { items: kids } : {}) };
}
function list() {
  return FAMILIES.map((f) => ({ id: f.id, name: f.name, hint: f.hint, empty: f.empty,
    items: [...providers.filter((p) => p.family === f.id).flatMap((p) => p.nodes()),
      ...[...items.values()].filter((i) => i.family === f.id && !i.parent).map(node)] }));
}

async function run(win, id) {
  const prov = typeof id === 'string' && providers.find((p) => id.startsWith(p.prefix));
  if (prov && win) {
    try { return { ok: true, ...(await prov.run({ win, tab: win.active || null }, id)) }; } catch (e) { return { error: String(e && e.message || e) }; }
  }
  const item = typeof id === 'string' && items.get(id);
  if (item && item.kind !== 'run') return { error: 'Not a command' };
  if (!item || !win) return { error: 'Unknown command' };
  try {
    const result = await item.run({ win, tab: win.active || null });
    // "stay" items (settings) keep the wheel open and get the fresh tree back
    return { ok: true, ...(item.stay ? { stay: true, families: list(), color: require('../settings').get('hexColor'), mode: require('../settings').get('hexMode') } : {}),
      ...(result && typeof result === 'object' ? result : {}) };
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
}

// ---------- the wheel window ----------
// Hex has its own small always-on-top window, so the wheel opens right at the mouse — also outside Rove's window.
const W = 320, H = 340, CX = 160, CY = 116; // window size and where the wheel's centre sits in it (at Normal size)
const SIZES = { small: 0.8, normal: 1, large: 1.25 };
const scale = () => SIZES[require('../settings').get('hexSize')] || 1;
let wheel = null;   // BrowserWindow
let target = null;  // the Rove window Hex acts on
let openedAt = 0;
let testNoMouse = false; // tests drive the wheel themselves; the real mouse must never reach it

function wheelWindow() {
  if (wheel && !wheel.isDestroyed()) return wheel;
  const { BrowserWindow } = require('electron');
  const { lockUiView, UI_PREFS } = require('../window');
  wheel = new BrowserWindow({ width: W, height: H, show: false, frame: false, transparent: true, resizable: false,
    movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false,
    alwaysOnTop: true, backgroundColor: '#00000000', webPreferences: UI_PREFS });
  wheel.setAlwaysOnTop(true, 'pop-up-menu');
  if (testNoMouse) wheel.setIgnoreMouseEvents(true);
  // skipTransformProcessType: without it macOS turns Rove into a Dock-less helper app
  wheel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  const home = 'pb://hex/index.html';
  lockUiView(wheel.webContents, home);
  wheel.loadURL(home);
  wheel.on('blur', () => { if (Date.now() - openedAt > 300) close(); }); // clicking anywhere else closes it
  wheel.on('closed', () => { wheel = null; });
  return wheel;
}

// Put the wheel's centre at a screen point (kept on that screen).
function place(p) {
  // Size = the whole page zoomed (so every click and angle stays in the same units) and a matching window.
  const s = scale(), w = Math.round(W * s), h = Math.round(H * s);
  const wa = screen.getDisplayNearestPoint(p).workArea;
  const x = Math.round(Math.max(wa.x, Math.min(wa.x + wa.width - w, p.x - CX * s)));
  const y = Math.round(Math.max(wa.y, Math.min(wa.y + wa.height - h, p.y - CY * s)));
  wheel.setBounds({ x, y, width: w, height: h });
  wheel.webContents.setZoomFactor(s);
}

function open(win) {
  if (!win || win.destroyed) return;
  const w = wheelWindow();
  if (w.isVisible()) return close(); // the trigger again closes it
  target = win;
  const settings = require('../settings');
  place(screen.getCursorScreenPoint());
  const send = () => w.webContents.send('hex:open', { families: list(), color: settings.get('hexColor'), mode: settings.get('hexMode') });
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send); else send();
  openedAt = Date.now();
  w.show();
  w.focus();
}
const wheelOpen = () => !!wheel && !wheel.isDestroyed() && wheel.isVisible();

function close() {
  if (!wheel || wheel.isDestroyed() || !wheel.isVisible()) return;
  wheel.webContents.send('hex:closed');
  wheel.hide();
  if (target && !target.destroyed) target.focusActive();
}

// The wheel asks to follow the mouse (entering a family / group re-centres it on the cursor).
function recenter() { if (wheel && wheel.isVisible()) place(screen.getCursorScreenPoint()); }

const isWheel = (wc) => !!wheel && !wheel.isDestroyed() && wc === wheel.webContents;
const getTarget = () => (target && !target.destroyed ? target : null);

// Only these settings can be changed from the wheel (validated by the settings schema too).
const WHEEL_SETTINGS = new Set(['hexTrigger']);
function set(key, value) {
  if (!WHEEL_SETTINGS.has(key)) return { error: 'Not allowed' };
  const settings = require('../settings');
  settings.set({ [key]: value });
  return settings.get(key) === value ? { ok: true, families: list() } : { error: 'Use a modifier (⌘ ⌃ ⌥ / Ctrl Alt) with a letter or number, or an F-key' };
}

module.exports = { FAMILIES, register, provide, list, run, open, close, recenter, set, isWheel, getTarget, wheelOpen, wheelWindow: () => wheel, _items: items,
  _testNoMouse(on) { testNoMouse = !!on; if (wheel && !wheel.isDestroyed()) wheel.setIgnoreMouseEvents(!!on); } };
