// Tab strip: draws the tabs from the main process's state; clicks/drags/menus are sent back as commands.
import { $, pb, ICON, tabIconNode } from './util.js';
import { horizontalDrag } from './hdrag.js';

const tabsEl = $('tabs');
const els = new Map(); // tab id -> element
let state = { tabs: [] };

function tabEl(id) {
  let el = els.get(id);
  if (el) return el;
  el = document.createElement('div');
  el.className = 'tab';
  el.dataset.id = id;
  el.innerHTML = `<div class="fav"></div><div class="title"></div><span class="badge"></span>
    <button class="close" title="Close tab (⌘W)">${ICON.close}</button>`;
  el.addEventListener('mousedown', (e) => {
    if (e.button === 0 && !e.target.closest('.close')) pb.send('tab:activate', id);
  });
  el.addEventListener('auxclick', (e) => { if (e.button === 1) pb.send('tab:close', id); });
  el.querySelector('.close').addEventListener('click', (e) => { e.stopPropagation(); pb.send('tab:close', id); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); menu(id); });
  els.set(id, el);
  return el;
}

function render(s) {
  state = s;
  document.documentElement.classList.toggle('private', !!s.private);
  $('private-badge').hidden = !s.private;
  const ids = new Set(s.tabs.map((t) => t.id));
  for (const [id, el] of els) if (!ids.has(id)) { el.remove(); els.delete(id); }
  if (!drag.dragging) tabsEl.replaceChildren(...s.tabs.map((t) => tabEl(t.id)));
  for (const t of s.tabs) {
    const el = tabEl(t.id);
    el.classList.toggle('active', t.active);
    el.classList.toggle('pinned', t.pinned);
    el.classList.toggle('asleep', t.asleep);
    el.querySelector('.fav').replaceChildren(tabIconNode(t));
    el.querySelector('.title').textContent = t.title || 'New Tab';
    el.querySelector('.badge').innerHTML = t.audible ? ICON.speaker : t.asleep ? ICON.moon : '';
    el.title = (t.title || 'New Tab') + (t.url ? `\n${t.url}` : '') + (t.asleep ? '\n(sleeping to save memory)' : '');
  }
  requestAnimationFrame(() => {
    for (const el of els.values()) el.classList.toggle('narrow', !el.classList.contains('pinned') && el.offsetWidth < 84);
  });
}

async function menu(id) {
  const t = state.tabs.find((x) => x.id === id);
  if (!t) return;
  const i = state.tabs.indexOf(t);
  const choice = await pb.invoke('menu:popup', [
    { id: 'new', label: 'New Tab to the Right' },
    { type: 'separator' },
    { id: 'reload', label: 'Reload' },
    { id: 'dup', label: 'Duplicate Tab' },
    { id: 'pin', label: t.pinned ? 'Unpin Tab' : 'Pin Tab' },
    { id: 'sleep', label: 'Put Tab to Sleep', enabled: !t.active && !t.asleep && !t.audible },
    { type: 'separator' },
    { id: 'close', label: 'Close Tab' },
    { id: 'others', label: 'Close Other Tabs', enabled: state.tabs.some((x) => x.id !== id && !x.pinned) },
    { id: 'right', label: 'Close Tabs to the Right', enabled: i < state.tabs.length - 1 },
    { type: 'separator' },
    { id: 'reopen', label: 'Reopen Closed Tab', enabled: state.closedCount > 0 },
  ]);
  if (choice === 'new') pb.send('tab:new', { index: i + 1 });
  if (choice === 'reload') pb.send('tab:reload', id);
  if (choice === 'dup') pb.send('tab:duplicate', id);
  if (choice === 'pin') pb.send('tab:pin', { id, pinned: !t.pinned });
  if (choice === 'sleep') pb.send('tab:sleep', id);
  if (choice === 'close') pb.send('tab:close', id);
  if (choice === 'others') pb.send('tab:close-others', id);
  if (choice === 'right') pb.send('tab:close-right', id);
  if (choice === 'reopen') pb.send('tab:reopen');
}

// Drag tabs left/right (pinned and normal tabs stay in their own groups).
const drag = horizontalDrag(tabsEl, {
  item: '.tab',
  group: (el) => el.classList.contains('pinned'),
  drop: (el, order) => pb.send('tab:move', { id: Number(el.dataset.id), index: order.indexOf(el) }),
});

$('newtab').onclick = () => pb.send('tab:new', {});
$('tabstrip').addEventListener('dblclick', (e) => { if (e.target.classList.contains('drag-fill')) pb.send('tab:new', {}); });
new ResizeObserver(() => render(state)).observe($('tabstrip'));

export const tabstrip = { render, get state() { return state; } };
