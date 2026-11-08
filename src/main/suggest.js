// Address-bar suggestions.
// Local (instant, never leaves the Mac): what you typed, open tabs, favorites, history.
// Remote (optional, Settings → Search): your search engine's suggestions, fetched with a short timeout.
const { net } = require('electron');
const urls = require('./urls');
const history = require('./history');
const favorites = require('./favorites');
const settings = require('./settings');

const strip = (u) => String(u || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '');
const looksLikeUrl = (text) => !/\s/.test(text) && (/^[a-z][\w+.-]*:\/\//i.test(text) || /^[\w-]+(\.[\w-]+)+([:/?#]|$)/.test(text) || /^localhost(:|\/|$)/i.test(text));

// Inline completion: "you" → "youtube.com" (only from places you've been, only when it's a prefix).
function inlineFor(text, candidates) {
  const t = text.toLowerCase();
  if (!t || /\s/.test(t) || t.length < 2) return null;
  for (const c of candidates) {
    const bare = strip(c.url).replace(/\/$/, '');
    const host = bare.split('/')[0];
    if (host.toLowerCase().startsWith(t.replace(/^www\./, ''))) return { completion: host.slice(t.replace(/^www\./, '').length), url: c.url, full: host };
    if (t.includes('/') && bare.toLowerCase().startsWith(t)) return { completion: bare.slice(t.length), url: c.url, full: bare };
  }
  return null;
}

// Instant part.
function local(text, { win } = {}) {
  const q = String(text || '').trim();
  if (!q) return { items: [], inline: null };
  const ql = q.toLowerCase();
  const items = [];
  const seen = new Set();
  const add = (item) => {
    const k = item.url ? strip(item.url).replace(/\/$/, '') : `search:${item.text}`;
    if (seen.has(k)) return;
    seen.add(k);
    items.push(item);
  };

  const hist = history.match(q, 8);
  const favs = favorites.list().filter((f) => f.url.toLowerCase().includes(ql) || (f.title || '').toLowerCase().includes(ql));
  const inline = inlineFor(q, [...hist, ...favs]); // most-used place wins

  // 1) What you typed (completed inline target, a web address, or a search)
  if (inline) add({ type: 'url', title: inline.full, url: inline.url, primary: true });
  else if (looksLikeUrl(q)) add({ type: 'url', title: q, url: urls.fromInput(q), primary: true });
  else add({ type: 'search', text: q, title: q, primary: true });

  // 2) Open tabs (switch to them)
  for (const t of win?.tabs || []) {
    if (t === win.active || items.length > 7) continue;
    const s = t.state();
    if (s.url && (s.url.toLowerCase().includes(ql) || (s.title || '').toLowerCase().includes(ql))) {
      add({ type: 'tab', tabId: s.id, title: s.title, url: s.url, favicon: s.favicon });
    }
  }
  // 3) Favorites, 4) history
  for (const f of favs.slice(0, 3)) add({ type: 'favorite', title: f.title || strip(f.url), url: f.url, favicon: f.favicon });
  for (const h of hist) { if (items.length >= 8) break; add({ type: 'history', title: h.title || strip(h.url), url: h.url, favicon: h.favicon }); }
  return { items, inline: inline ? { completion: inline.completion } : null };
}

// Remote part. Small cache so typing back and forth doesn't re-ask.
const cache = new Map();
async function remote(text) {
  const q = String(text || '').trim();
  if (!q || !settings.get('searchSuggestions') || looksLikeUrl(q)) return [];
  const engine = urls.engine();
  if (!engine.suggest) return [];
  const key = `${engine.id}|${q.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key);
  let list = [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await net.fetch(engine.suggest.replace('%s', encodeURIComponent(q)), {
      signal: ctrl.signal, credentials: 'omit', headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      // OpenSearch format: [query, [suggestions...]]; some engines return [{ phrase }]
      if (Array.isArray(data) && Array.isArray(data[1])) list = data[1];
      else if (Array.isArray(data)) list = data.map((x) => x?.phrase || x?.q || x).filter((x) => typeof x === 'string');
    }
  } catch { list = []; }
  list = list.filter((s) => typeof s === 'string' && s.trim() && s.toLowerCase() !== q.toLowerCase()).slice(0, 5)
    .map((s) => ({ type: 'search', text: s, title: s }));
  cache.set(key, list);
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return list;
}

module.exports = { local, remote, inlineFor, looksLikeUrl };
