// Favorites bar + the Edge-style "Edit favorite" popup (name + URL). Data lives in the main process.
import { $, pb, faviconNode } from './util.js';
import * as popups from './popups.js';
import { horizontalDrag } from './hdrag.js';

let favorites = [];

export function render(list) {
  favorites = list;
  if (!drag.dragging) $('favs').replaceChildren(...list.map(item));
}

// Drag favorites left/right to reorder (same feel as tabs).
const drag = horizontalDrag($('favs'), {
  item: '.favitem',
  drop: (_el, order) => pb.send('fav:reorder', order.map((x) => Number(x.dataset.id))),
});

function item(f) {
  const b = document.createElement('button');
  b.className = 'favitem';
  b.dataset.id = f.id;
  b.dataset.popupAnchor = '';
  b.title = f.title ? `${f.title}\n${f.url}` : f.url;
  b.append(faviconNode(f.favicon, f.title || f.url));
  // An empty name is allowed: the favorite then shows just its icon.
  if (f.title) b.append(Object.assign(document.createElement('span'), { textContent: f.title }));
  else b.classList.add('icon-only');

  b.addEventListener('click', (e) => pb.send('fav:open', { url: f.url, disposition: e.metaKey ? 'background' : 'current' }));
  b.addEventListener('auxclick', (e) => { if (e.button === 1) pb.send('fav:open', { url: f.url, disposition: 'background' }); });
  b.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    const c = await pb.invoke('menu:popup', [
      { id: 'open', label: 'Open' },
      { id: 'tab', label: 'Open in New Tab' },
      { type: 'separator' },
      { id: 'edit', label: 'Edit…' },
      { id: 'remove', label: 'Remove' },
    ]);
    if (c === 'open') pb.send('fav:open', { url: f.url });
    if (c === 'tab') pb.send('fav:open', { url: f.url, disposition: 'foreground' });
    if (c === 'edit') edit(f.id);
    if (c === 'remove') pb.send('fav:remove', f.id);
  });

  return b;
}

// ---------- edit popup ----------
const pop = $('fav-pop'), name = $('fp-name'), urlIn = $('fp-url');
let editingId = null;

function close() { pop.hidden = true; editingId = null; popups.unregister('fav'); }

export function edit(id, { added = false, anchor } = {}) {
  const f = favorites.find((x) => x.id === Number(id));
  if (!f) return;
  popups.register('fav', () => { pop.hidden = true; editingId = null; });
  editingId = f.id;
  $('fp-title').textContent = added ? 'Favorite added' : 'Edit favorite';
  name.value = f.title;
  urlIn.value = f.url;
  urlIn.classList.remove('bad');
  pop.hidden = false;
  const barVisible = !document.body.classList.contains('no-favbar');
  const el = anchor || (barVisible && $('favs').querySelector(`[data-id="${f.id}"]`)) || $('star');
  const r = el.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8))}px`;
  name.focus();
  name.select();
}

async function save() {
  if (editingId == null) return close();
  const res = await pb.invoke('fav:update', { id: editingId, title: name.value.trim(), url: urlIn.value.trim() });
  if (res?.error) { urlIn.classList.add('bad'); urlIn.focus(); return; }
  close();
  pb.send('ui:focus-page');
}

$('fp-save').onclick = save;
$('fp-cancel').onclick = () => { close(); pb.send('ui:focus-page'); };
$('fp-remove').onclick = () => { if (editingId != null) pb.send('fav:remove', editingId); close(); pb.send('ui:focus-page'); };
for (const input of [name, urlIn]) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); pb.send('ui:focus-page'); }
  });
}
urlIn.addEventListener('input', () => urlIn.classList.remove('bad'));

// ☆ / ⌘D: add the page (if needed) and open the popup so you pick the name first.
export async function starPage() {
  const fav = await pb.invoke('fav:add-current');
  if (!fav) return;
  if (!favorites.some((x) => x.id === fav.id)) favorites = [...favorites, fav]; // list update may arrive later
  edit(fav.id, { added: fav.added, anchor: fav.added ? undefined : $('star') });
}

export const isFavorite = (u) => {
  const key = (x) => String(x || '').replace(/#.*$/, '').replace(/\/$/, '');
  return !!u && favorites.some((f) => key(f.url) === key(u));
};

$('star').dataset.popupAnchor = '';
$('star').onclick = starPage;
