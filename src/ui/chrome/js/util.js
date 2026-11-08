// Small helpers shared by the toolbar UI modules.
export const $ = (id) => document.getElementById(id);
export const pb = window.pb;
// "Open in background" modifier: ⌘-click on Mac, Ctrl-click on Windows / Linux (on a Mac Ctrl-click is a right-click).
export const IS_MAC = /Mac/.test(navigator.platform);
export const bgClick = (e) => (IS_MAC ? e.metaKey : e.ctrlKey);

export const ICON = {
  close: '<svg viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13"/></svg>',
  lock: '<svg viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>',
  globe: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/></svg>',
  history: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></svg>',
  gear: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/></svg>',
  warn: '<svg viewBox="0 0 16 16"><path d="M8 2l6.5 11.5h-13z"/><path d="M8 6.5v3M8 11.5v.2"/></svg>',
  speaker: '<svg viewBox="0 0 16 16"><path d="M2.5 6h2.5L8.5 3v10L5 10H2.5z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4"/></svg>',
  moon: '<svg viewBox="0 0 16 16"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/></svg>',
};

const INTERNAL_ICONS = { newtab: ICON.globe, history: ICON.history, settings: ICON.gear, error: ICON.warn };

export function letterNode(label) {
  const d = document.createElement('div');
  d.className = 'letter';
  d.textContent = (String(label || '').replace(/^https?:\/\/(www\.)?/, '')[0] || '•');
  return d;
}

export function faviconNode(src, label) {
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.draggable = false; // dragging by the icon drags the tab / favorite, not the picture
    img.onerror = () => img.replaceWith(letterNode(label));
    return img;
  }
  return letterNode(label);
}

export function tabIconNode(tab) {
  if (tab.loading) return Object.assign(document.createElement('div'), { className: 'spinner' });
  if (tab.internal) return Object.assign(document.createElement('div'), { innerHTML: INTERNAL_ICONS[tab.internal] || ICON.globe });
  return faviconNode(tab.favicon, tab.title || tab.url);
}

export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u || ''; } };

export function timeLabel(t) {
  const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  if (t >= +today) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (t >= +today - 864e5) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB`
  : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);

// Tiny pub/sub for UI state
export function store(initial) {
  let value = initial;
  const subs = new Set();
  return {
    get: () => value,
    set(v) { value = v; subs.forEach((fn) => fn(value)); },
    sub(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
