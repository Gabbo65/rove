// Address-bar input → URL, search engines, and our internal pb:// pages.
const settings = require('./settings');

const ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s',
    suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s',
    suggest: 'https://api.bing.com/osjson.aspx?query=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s',
    suggest: 'https://duckduckgo.com/ac/?q=%s&type=list' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s',
    suggest: 'https://ac.ecosia.org/autocomplete?q=%s&type=list' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s',
    suggest: 'https://search.brave.com/api/suggest?q=%s' },
};

// The engine in use (falls back to Google if the setting points at something unknown).
function engine() {
  const id = settings.get('searchEngine');
  if (id === 'custom') {
    const c = settings.get('customSearch');
    if (c && c.url && c.url.includes('%s')) return { id: 'custom', name: c.name || 'Custom', url: c.url, suggest: c.suggestUrl || '' };
  }
  const e = ENGINES[id] || ENGINES.google;
  return { id: ENGINES[id] ? id : 'google', ...e };
}

function searchUrl(query) {
  return engine().url.replace('%s', encodeURIComponent(query));
}

// Internal pages: pb://newtab, pb://history, pb://settings, pb://error
const INTERNAL_PAGES = ['newtab', 'history', 'settings', 'error'];
const INTERNAL_TITLES = { newtab: 'New Tab', history: 'History', settings: 'Settings', error: 'Can’t reach this page' };
const NEWTAB = 'pb://newtab/';

function internalPage(url) {
  const m = /^pb:\/\/([a-z]+)/i.exec(url || '');
  return m && INTERNAL_PAGES.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
}
const isInternal = (url) => !!internalPage(url);
const isNewTab = (url) => internalPage(url) === 'newtab';

// What the user typed → a URL to load. Words become a search.
function fromInput(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^pb:\/\//i.test(s)) return isInternal(s) ? s : null;
  if (/^(https?|file|data|about|view-source):/i.test(s)) return s;
  if (/^[a-z][\w+.-]*:\/\//i.test(s)) return s; // other schemes the OS may handle
  if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s) || /^\[[0-9a-f:]+\](:\d+)?(\/|$)/i.test(s)) return 'http://' + s;
  if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/.test(s)) return 'https://' + s;
  return searchUrl(s);
}

// For display: no address for internal pages.
function displayUrl(url) { return isInternal(url) ? '' : url || ''; }

module.exports = { ENGINES, engine, searchUrl, fromInput, displayUrl, internalPage, isInternal, isNewTab, NEWTAB, INTERNAL_TITLES };
