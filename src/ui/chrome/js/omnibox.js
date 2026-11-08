// Address-bar suggestions dropdown: what you typed, open tabs, favorites, history, search suggestions.
// ↑/↓ choose · Enter go · Esc back to what you typed / close · Shift+Delete removes a history entry.
import { $, pb, faviconNode, hostOf } from './util.js';
import * as popups from './popups.js';
import { addressBar } from './toolbar.js';

const input = $('url');
const box = document.createElement('div');
box.id = 'suggest';
box.className = 'popup';
box.hidden = true;
document.body.append(box);

let typed = '';        // exactly what the user typed (without inline completion)
let items = [];
let sel = -1;          // -1 = the text box itself
let req = 0;
let remoteTimer = null;
let allowInline = true;
let engineName = 'Google';
pb.on('settings', (s) => { engineName = ({ google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo', ecosia: 'Ecosia', brave: 'Brave Search' })[s.searchEngine] || 'search'; });

const ICONS = {
  search: '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>',
  url: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/></svg>',
  history: '<svg viewBox="0 0 16 16"><path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8M2.5 2.5v2.7h2.7M8 5v3.2l2.2 1.4"/></svg>',
  tab: '<svg viewBox="0 0 16 16"><rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2 6.5h12"/></svg>',
  favorite: '<svg viewBox="0 0 16 16"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>',
};

function open() {
  if (!box.hidden) return;
  const r = $('urlform').getBoundingClientRect();
  box.style.left = `${r.left}px`;
  box.style.top = `${r.bottom + 4}px`;
  box.style.width = `${r.width}px`;
  box.hidden = false;
  popups.register('suggest', hide);
}
function hide() { box.hidden = true; items = []; sel = -1; }
export function close() { if (!box.hidden) { hide(); popups.unregister('suggest'); } }

function render() {
  if (!items.length) return close();
  open();
  box.replaceChildren(...items.map((it, i) => {
    const row = document.createElement('div');
    row.className = 'sg-row' + (i === sel ? ' sel' : '');
    const icon = document.createElement('div');
    icon.className = 'sg-icon';
    if ((it.type === 'history' || it.type === 'favorite' || it.type === 'tab') && it.favicon) icon.append(faviconNode(it.favicon, it.title));
    else icon.innerHTML = ICONS[it.type] || ICONS.url;
    const text = document.createElement('div');
    text.className = 'sg-text';
    const title = Object.assign(document.createElement('span'), { className: 'sg-title', textContent: it.type === 'search' ? it.text : it.title });
    const sub = document.createElement('span');
    sub.className = 'sg-sub';
    sub.textContent = it.type === 'search' ? ` — ${engineName} search` : it.url ? ` — ${hostOf(it.url)}` : '';
    text.append(title, sub);
    row.append(icon, text);
    if (it.type === 'tab') row.append(Object.assign(document.createElement('span'), { className: 'sg-badge', textContent: 'Switch to tab' }));
    row.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the address bar
    row.addEventListener('click', (e) => choose(it, e.metaKey ? 'background' : 'current'));
    return row;
  }));
}

function choose(it, disposition = 'current') {
  close();
  if (it.type === 'tab') { pb.send('tab:activate', it.tabId); addressBar.reset(); input.blur(); return; }
  addressBar.submit(it.type === 'search' ? it.text : it.url, disposition);
}

async function update(fromDelete) {
  const id = ++req;
  const q = typed.trim();
  clearTimeout(remoteTimer);
  if (!q) { close(); return; }
  const res = await pb.invoke('omnibox:local', typed);
  if (id !== req) return;
  items = res.items;
  sel = -1;
  // inline completion (not after deleting, and only while the caret is at the end)
  if (res.inline && allowInline && !fromDelete && input.value === typed && input.selectionStart === typed.length) {
    input.value = typed + res.inline.completion;
    input.setSelectionRange(typed.length, input.value.length);
  }
  render();
  remoteTimer = setTimeout(async () => {
    const extra = await pb.invoke('omnibox:remote', typed);
    if (id !== req || !extra.length) return;
    const seen = new Set(items.filter((x) => x.type === 'search').map((x) => x.text.toLowerCase()));
    items = items.concat(extra.filter((x) => !seen.has(x.text.toLowerCase()))).slice(0, 12);
    render();
  }, 120);
}

input.addEventListener('input', (e) => {
  const deleting = (e.inputType || '').startsWith('delete');
  typed = input.value;
  allowInline = !deleting;
  update(deleting);
});

input.addEventListener('keydown', (e) => {
  if (box.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && input.value.trim()) { typed = input.value; update(true); e.preventDefault(); return; }
  if (box.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    sel = e.key === 'ArrowDown' ? Math.min(items.length - 1, sel + 1) : Math.max(-1, sel - 1);
    const it = items[sel];
    input.value = sel < 0 ? typed : it.type === 'search' ? it.text : it.url;
    render();
  } else if (e.key === 'Enter' && sel >= 0) {
    e.preventDefault();
    choose(items[sel], e.metaKey ? 'background' : 'current');
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (sel >= 0 || input.value !== typed) { sel = -1; input.value = typed; render(); }
    else { close(); addressBar.reset(); input.blur(); pb.send('ui:focus-page'); }
  } else if (e.key === 'Delete' && e.shiftKey && sel >= 0 && items[sel].type === 'history') {
    e.preventDefault();
    pb.send('omnibox:delete', items[sel].url);
    items.splice(sel, 1);
    sel = Math.min(sel, items.length - 1);
    render();
  } else if (e.key === 'Tab' && input.selectionStart !== input.selectionEnd) {
    // accept the inline completion
    e.preventDefault();
    typed = input.value;
    input.setSelectionRange(input.value.length, input.value.length);
    update(true);
  }
});

input.addEventListener('blur', () => setTimeout(close, 0));
$('urlform').addEventListener('submit', close, true);
