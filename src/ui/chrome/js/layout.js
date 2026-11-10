// Toolbar layout from Settings → Appearance: which buttons show, in which order; tabs on top or on the left.
import { $ } from './util.js';

const ITEMS = { back: 'back', forward: 'forward', reload: 'reload', home: 'home-btn', address: 'urlform',
  history: 'hist-btn', downloads: 'dl-btn', remote: 'remote-btn', menu: 'menu-btn' };

let last = '';
export function applyLayout(s) {
  const order = Array.isArray(s.toolbarLayout) ? s.toolbarLayout : Object.keys(ITEMS);
  const key = JSON.stringify([order, s.tabsPosition]);
  if (key === last) return false;
  last = key;
  const bar = $('toolbar');
  for (const [id, elId] of Object.entries(ITEMS)) $(elId).classList.toggle('tb-off', !order.includes(id));
  // Wanted order: the shown items, then the hidden ones; the update button always right before the menu.
  const wanted = [...order, ...Object.keys(ITEMS).filter((id) => !order.includes(id))].map((id) => $(ITEMS[id]));
  wanted.splice(wanted.indexOf($('menu-btn')), 0, $('update-btn'));
  // Moving an element blurs it (you may be typing in the address bar): only move when the order changed.
  const focused = document.activeElement;
  if (wanted.some((el, i) => bar.children[i] !== el)) bar.append(...wanted);

  // Vertical tabs: the tab strip moves into a sidebar left of the page.
  const vertical = s.tabsPosition === 'left';
  document.body.classList.toggle('vtabs', vertical);
  const strip = $('tabstrip'), home = vertical ? $('side') : $('top');
  if (strip.parentElement !== home) home.prepend(strip);
  if (focused && focused !== document.activeElement && document.contains(focused)) focused.focus({ preventScroll: true });
  return true;
}

