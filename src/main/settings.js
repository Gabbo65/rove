// Browser settings: defaults + validation, stored in the database (kv table).
// Anything that changes a setting goes through set(); listeners get the new values.
const { EventEmitter } = require('events');
const path = require('path');
const { kv } = require('./db');

const events = new EventEmitter();

// Each setting: default value + a validator that returns the cleaned value or undefined (= reject).
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const oneOf = (...opts) => (v) => (opts.includes(v) ? v : undefined);
const webUrl = (v) => (typeof v === 'string' && (v === '' || /^https?:\/\/\S+$/i.test(v)) ? v : undefined);
const SEARCH_ENGINES = ['google', 'bing', 'duckduckgo', 'ecosia', 'brave', 'custom'];
// Toolbar items, in their default order. The address bar and the … menu can be moved but never hidden.
const TOOLBAR_ITEMS = ['back', 'forward', 'reload', 'home', 'address', 'history', 'downloads', 'remote', 'menu'];
const toolbarLayout = (v) => (Array.isArray(v) && v.every((x) => TOOLBAR_ITEMS.includes(x)) && new Set(v).size === v.length
  && v.includes('address') && v.includes('menu') ? [...v] : undefined);

const SCHEMA = {
  // General
  startPage: { default: 'newtab', check: oneOf('newtab', 'url') },          // first tab of a new window
  startUrl: { default: '', check: webUrl },
  theme: { default: 'system', check: oneOf('system', 'light', 'dark') },
  // Appearance (src/main/look.js turns these into CSS)
  lookTheme: { default: 'default', check: oneOf('default', 'lavender', 'midnight', 'forest', 'sunset', 'mono', 'contrast') },
  accentColor: { default: '', check: (v) => (typeof v === 'string' && (v === '' || /^#[0-9a-f]{6}$/i.test(v)) ? v.toLowerCase() : undefined) },
  uiDensity: { default: 'normal', check: oneOf('compact', 'normal', 'roomy') },
  uiCorners: { default: 'round', check: oneOf('round', 'square') },
  uiFont: { default: 'system', check: oneOf('system', 'rounded', 'serif', 'mono') },
  // Layout
  toolbarLayout: { default: ['back', 'forward', 'reload', 'address', 'history', 'downloads', 'remote', 'menu'], check: toolbarLayout },
  tabsPosition: { default: 'top', check: oneOf('top', 'left') },
  // Glass (Liquid-Glass style). 'floating' (the toolbar floating over the page) is planned.
  toolbarStyle: { default: 'solid', check: oneOf('solid', 'docked') },
  pagesStyle: { default: 'solid', check: oneOf('solid', 'glass') },
  // Your own CSS for Rove's toolbar and built-in pages (web pages are never touched)
  customCss: { default: '', check: (v) => (typeof v === 'string' && v.length <= 50_000 ? v : undefined) },
  glassBlur: { default: true, check: bool }, // off = clear glass (macOS): the desktop shows sharp, 100% = invisible
  glassLevel: { default: 85, check: (v) => (Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v) : undefined) }, // transparency %
  // New Tab page
  ntBackground: { default: 'plain', check: oneOf('plain', 'gradient', 'image') },
  ntGradient: { default: 'rove', check: oneOf('rove', 'dusk', 'sunset', 'ocean', 'forest', 'ember') },
  ntImage: { default: 0, check: (v) => (Number.isSafeInteger(v) && v >= 0 ? v : undefined) },  // version of the picture (0 = none)
  ntDim: { default: 25, check: (v) => (Number.isFinite(v) && v >= 0 && v <= 70 ? Math.round(v) : undefined) },
  ntShowSearch: { default: true, check: bool },
  ntShowFavorites: { default: true, check: bool },
  ntClock: { default: 'off', check: oneOf('off', 'clock', 'greeting') },
  showFavoritesBar: { default: true, check: bool },
  // Search
  searchEngine: { default: 'google', check: oneOf(...SEARCH_ENGINES) },
  customSearch: {
    default: { name: '', url: '', suggestUrl: '' },
    check: (v) => {
      if (!v || typeof v !== 'object') return undefined;
      const ok = (u) => u === '' || (/^https?:\/\/\S+$/i.test(u) && u.includes('%s'));
      const c = { name: String(v.name || '').slice(0, 60), url: String(v.url || ''), suggestUrl: String(v.suggestUrl || '') };
      return ok(c.url) && ok(c.suggestUrl) ? c : undefined;
    },
  },
  searchSuggestions: { default: true, check: bool },                         // ask the engine for suggestions while typing
  // Downloads
  downloadDir: { default: '', check: (v) => (typeof v === 'string' && (v === '' || path.isAbsolute(v)) ? v : undefined) },
  askDownloadLocation: { default: false, check: bool },
  // Passwords & autofill
  offerSavePasswords: { default: true, check: bool },
  autofillPasswords: { default: true, check: bool },
  autofillForms: { default: true, check: bool },
  // Sleeping tabs: unload tabs you haven't looked at for a while to free memory.
  sleepingTabs: { default: true, check: bool },
  sleepAfterMinutes: { default: 30, check: (v) => (Number.isFinite(v) && v >= 1 && v <= 24 * 60 ? Math.round(v) : undefined) },
  updateCheck: { default: true, check: bool },
  // Phone remote: off = nothing listens on the network at all.
  remoteEnabled: { default: true, check: bool },
  // Hex: the shortcut that opens the wheel (an Electron accelerator; needs a modifier unless it's an F-key)
  hexTrigger: { default: 'Alt+H', check: (v) => (typeof v === 'string' && v.length < 40
    && /^((CmdOrCtrl|Ctrl|Alt|Shift|Super)\+)*([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Backquote|Period|Comma|Slash)$/.test(v)
    && (/\+/.test(v) || /^F\d/.test(v)) && !/^Shift\+[A-Z0-9]$/.test(v) ? v : undefined) },
  hexSeeded: { default: false, check: bool }, // the Injector example was added once
  hexSize: { default: 'normal', check: oneOf('small', 'normal', 'large') },
  hexMode: { default: 'smooth', check: oneOf('smooth', 'bumpy') }, // smooth: hover enters families/groups · bumpy: clicks
  hexColor: { default: 'violet', check: oneOf('violet', 'magenta', 'blue', 'cyan', 'green', 'amber', 'red') },
  remoteQrAuto: { default: true, check: bool },  // QR pops up by itself while no phone is connected (only with the remote on)
};

let cache = null;

function load() {
  const saved = kv.get('settings', {}) || {};
  cache = {};
  for (const [key, def] of Object.entries(SCHEMA)) {
    const v = key in saved ? def.check(saved[key]) : undefined;
    cache[key] = v === undefined ? def.default : v;
  }
  return cache;
}

function all() { return { ...(cache || load()) }; }
function get(key) { return (cache || load())[key]; }

// Returns the keys that actually changed. Unknown keys / invalid values are ignored.
function set(patch) {
  const current = cache || load();
  const changed = {};
  for (const [key, value] of Object.entries(patch || {})) {
    const def = SCHEMA[key];
    if (!def) continue;
    const clean = def.check(value);
    if (clean === undefined || JSON.stringify(clean) === JSON.stringify(current[key])) continue;
    current[key] = clean;
    changed[key] = clean;
  }
  if (Object.keys(changed).length) {
    kv.set('settings', current);
    events.emit('change', changed, all());
  }
  return changed;
}

function reset(key) {
  if (!SCHEMA[key]) return;
  set({ [key]: SCHEMA[key].default });
}

const NEWTAB_KEYS = ['ntBackground', 'ntGradient', 'ntImage', 'ntDim', 'ntShowSearch', 'ntShowFavorites', 'ntClock'];
const LOOK_KEYS = ['theme', 'lookTheme', 'accentColor', 'uiDensity', 'uiCorners', 'uiFont', 'tabsPosition', 'toolbarStyle', 'pagesStyle', 'glassLevel', 'glassBlur', 'customCss'];

module.exports = { NEWTAB_KEYS, TOOLBAR_ITEMS, LOOK_KEYS, SCHEMA, load, all, get, set, reset, on: (...a) => events.on(...a), off: (...a) => events.off(...a) };
