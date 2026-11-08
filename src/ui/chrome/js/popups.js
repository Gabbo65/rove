// Popups drawn over the page (history, downloads, favorite editor, suggestions…).
// While any is open, the main process lifts this UI above the page; clicking outside closes them.
import { pb } from './util.js';

const open = new Map(); // name -> close()

function sync() { pb.send('ui:overlay', open.size > 0); }

export function register(name, close) {
  // Opening one popup closes the others (except the address-bar suggestions, which live next to them).
  for (const [other, fn] of [...open]) if (other !== name && other !== 'suggest' && name !== 'suggest') { open.delete(other); fn(); }
  open.set(name, close);
  sync();
}

export function unregister(name) {
  if (open.delete(name)) sync();
}

export function closeAll(except) {
  for (const [name, fn] of [...open]) if (name !== except) { open.delete(name); fn(); }
  sync();
}

export const isOpen = (name) => open.has(name);

// Clicks on the empty page area (the page under us) or on the toolbar outside a popup close popups.
document.addEventListener('mousedown', (e) => {
  if (!open.size) return;
  if (e.target.closest('.popup, #fav-pop, #save-pop, [data-popup-anchor]')) return;
  if (e.target.closest('#urlform')) return closeAll('suggest'); // clicking the address bar keeps its suggestions
  closeAll();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && open.size && !e.defaultPrevented) closeAll();
});
pb.on('command', ({ name }) => { if (name === 'close-popups') closeAll(); });
