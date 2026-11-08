// Browser UI entry: wires the modules to the main process.
import { $, pb } from './util.js';
import { tabstrip } from './tabstrip.js';
import { showTab, focusAddressBar } from './toolbar.js';
import * as favbar from './favbar.js';
import { renderDownloads, showDownloads } from './panels.js';
import * as popups from './popups.js';
import './omnibox.js';
import './savepop.js';
import './tabsearch.js';

if (new URLSearchParams(location.search).get('private')) document.documentElement.classList.add('private');

// The page view is placed exactly over #stage.
const stage = $('stage');
const reportRect = () => {
  const r = stage.getBoundingClientRect();
  pb.send('ui:content-rect', { x: r.left, y: r.top, width: r.width, height: r.height });
};
new ResizeObserver(reportRect).observe(stage);
window.addEventListener('resize', reportRect);

pb.on('state', (s) => {
  tabstrip.render(s);
  const active = s.tabs.find((t) => t.active) || null;
  showTab(active);
  $('star').classList.toggle('on', !!active && favbar.isFavorite(active.url));
  document.title = active ? active.title : 'Rove';
});

pb.on('favorites', (list) => {
  favbar.render(list);
  const active = tabstrip.state.tabs.find((t) => t.active);
  $('star').classList.toggle('on', !!active && favbar.isFavorite(active.url));
});

pb.on('downloads', renderDownloads);

pb.on('settings', (s) => {
  document.body.classList.toggle('no-favbar', !s.showFavoritesBar);
  reportRect();
});

pb.on('fullscreen', (on) => document.body.classList.toggle('fullscreen', !!on));

// Engine update available → button (red when the engine no longer gets security fixes).
const updateBtn = $('update-btn');
pb.on('update', (s) => {
  const show = s.status === 'update-available' || s.status === 'unsupported';
  updateBtn.hidden = !show;
  updateBtn.classList.toggle('urgent', s.status === 'unsupported');
  updateBtn.textContent = s.status === 'unsupported' ? 'Update now' : 'Update';
  updateBtn.title = s.mode === 'release' ? `Rove ${s.current} → ${s.latest}` : `Browser engine: Electron ${s.current} → ${s.latest}`;
});
updateBtn.onclick = () => pb.send('update:open');

// "…" menu (like Edge)
let currentSettings = {};
pb.on('settings', (s) => { currentSettings = s; });
$('menu-btn').onclick = async () => {
  const c = await pb.invoke('menu:popup', [
    { id: 'tab', label: 'New tab' },
    { id: 'win', label: 'New window' },
    { id: 'private', label: 'New InPrivate window' },
    { type: 'separator' },
    { id: 'history', label: 'History' },
    { id: 'downloads', label: 'Downloads' },
    { id: 'favbar', label: 'Show favorites bar', checked: !!currentSettings.showFavoritesBar },
    { type: 'separator' },
    { id: 'settings', label: 'Settings' },
    { id: 'update', label: 'Check for updates' },
  ]);
  if (c === 'tab') pb.send('tab:new', {});
  if (c === 'win') pb.send('win:new', {});
  if (c === 'private') pb.send('win:new', { isPrivate: true });
  if (c === 'history') pb.send('history:open-page');
  if (c === 'downloads') showDownloads(true);
  if (c === 'favbar') pb.send('settings:set', { showFavoritesBar: !currentSettings.showFavoritesBar });
  if (c === 'settings') pb.send('settings:open');
  if (c === 'update') pb.send('update:open');
};

pb.on('command', ({ name, id, added }) => {
  if (name === 'focus-url') { popups.closeAll(); focusAddressBar(); }
  else if (name === 'star') favbar.starPage();
  else if (name === 'edit-favorite') favbar.edit(id, { added });
  else if (name === 'downloads') showDownloads(!popups.isOpen('downloads'));
});

reportRect();
