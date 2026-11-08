// Tab search (⇧⌘A or the ⌄ button): find an open tab or reopen a recently closed one.
import { $, pb, ICON, faviconNode, tabIconNode, hostOf, timeLabel } from './util.js';
import * as popups from './popups.js';

const panel = $('ts-panel'), input = $('ts-input'), list = $('ts-list'), btn = $('tabsearch-btn');
btn.dataset.popupAnchor = '';
let data = { tabs: [], closed: [] };
let rows = [];   // flat list of { kind, ... } in display order
let sel = 0;

function matches(q, ...fields) { return !q || fields.some((f) => String(f || '').toLowerCase().includes(q)); }

function render() {
  const q = input.value.trim().toLowerCase();
  const open = data.tabs.filter((t) => matches(q, t.title, t.url));
  const closed = data.closed.filter((a) => a.tabs.some((x) => matches(q, x.title, x.url)));
  rows = [...open.map((t) => ({ kind: 'tab', t })), ...closed.map((a) => ({ kind: 'closed', a }))];
  sel = Math.min(sel, Math.max(0, rows.length - 1));
  const out = [];
  const head = (text) => Object.assign(document.createElement('div'), { className: 'ts-head', textContent: text });
  if (open.length) out.push(head(`Open tabs (${open.length})`));
  rows.forEach((r, i) => {
    if (r.kind === 'closed' && (i === 0 || rows[i - 1].kind !== 'closed')) out.push(head('Recently closed'));
    const row = document.createElement('div');
    row.className = 'row-btn ts-row' + (i === sel ? ' sel' : '');
    const text = document.createElement('div'); text.className = 'row-text';
    if (r.kind === 'tab') {
      row.append(r.t.pinned ? faviconNode(r.t.favicon, r.t.title) : tabIconNode({ ...r.t, loading: false }));
      text.append(Object.assign(document.createElement('div'), { className: 'row-title', textContent: r.t.title || 'New Tab' }),
        Object.assign(document.createElement('div'), { className: 'row-sub', textContent: [r.t.url ? hostOf(r.t.url) : '', r.t.asleep ? 'sleeping' : '', r.t.pinned ? 'pinned' : ''].filter(Boolean).join(' · ') }));
      row.append(text);
      const x = document.createElement('button');
      x.className = 'icon ts-close'; x.title = 'Close tab'; x.innerHTML = ICON.close;
      x.onclick = (e) => { e.stopPropagation(); pb.send('tab:close', r.t.id); setTimeout(refresh, 80); };
      row.append(x);
    } else {
      const first = r.a.tabs[0];
      row.append(faviconNode(first.favicon, first.title));
      const more = r.a.tabs.length > 1 ? ` + ${r.a.tabs.length - 1} more` : '';
      text.append(Object.assign(document.createElement('div'), { className: 'row-title', textContent: (first.title || first.url) + more }),
        Object.assign(document.createElement('div'), { className: 'row-sub', textContent: hostOf(first.url) }));
      row.append(text, Object.assign(document.createElement('div'), { className: 'row-meta', textContent: timeLabel(r.a.t) }));
    }
    row.addEventListener('mousedown', (e) => e.preventDefault());
    row.onclick = () => choose(r);
    out.push(row);
  });
  if (!rows.length) out.push(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'No matching tabs' }));
  list.replaceChildren(...out);
  list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}

function choose(r) {
  popups.closeAll();
  if (r.kind === 'tab') pb.send('tab:activate', r.t.id);
  else pb.send('tab:reopen-action', r.a.id);
}

async function refresh() { data = await pb.invoke('tabs:search-data'); render(); }

export async function openTabSearch() {
  if (popups.isOpen('tabsearch')) return popups.closeAll();
  popups.register('tabsearch', () => { panel.hidden = true; btn.classList.remove('open'); });
  input.value = '';
  sel = 0;
  await refresh();
  panel.hidden = false;
  btn.classList.add('open');
  input.focus();
}

input.addEventListener('input', () => { sel = 0; render(); });
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(rows.length - 1, sel + 1); render(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (rows[sel]) choose(rows[sel]); }
});
btn.onclick = openTabSearch;
pb.on('command', ({ name }) => { if (name === 'tab-search') openTabSearch(); });
