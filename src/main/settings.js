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

const SCHEMA = {
  // General
  startPage: { default: 'newtab', check: oneOf('newtab', 'url') },          // first tab of a new window
  startUrl: { default: '', check: webUrl },
  theme: { default: 'system', check: oneOf('system', 'light', 'dark') },
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

module.exports = { SCHEMA, load, all, get, set, reset, on: (...a) => events.on(...a), off: (...a) => events.off(...a) };
