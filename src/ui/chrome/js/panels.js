// History popup and downloads panel (toolbar buttons right of the address bar).
import { $, pb, faviconNode, hostOf, timeLabel, fmtBytes } from './util.js';
import * as popups from './popups.js';

// ---------- history popup ----------
const histBtn = $('hist-btn'), histPanel = $('hist-panel');
histBtn.dataset.popupAnchor = '';

function placeUnder(panel, btn) {
  const r = btn.getBoundingClientRect();
  panel.style.right = `${Math.max(8, innerWidth - r.right - 8)}px`;
}

async function openHistory() {
  popups.register('history', () => { histPanel.hidden = true; histBtn.classList.remove('open'); });
  const recent = await pb.invoke('history:recent');
  $('hp-empty').hidden = recent.length > 0;
  $('hp-list').replaceChildren(...recent.map((h) => {
    const row = document.createElement('button');
    row.className = 'row-btn';
    row.title = h.url;
    const text = document.createElement('div'); text.className = 'row-text';
    text.append(Object.assign(document.createElement('div'), { className: 'row-title', textContent: h.title || h.url }),
      Object.assign(document.createElement('div'), { className: 'row-sub', textContent: hostOf(h.url) }));
    row.append(faviconNode(h.favicon, hostOf(h.url)), text,
      Object.assign(document.createElement('div'), { className: 'row-meta', textContent: timeLabel(h.t) }));
    row.onclick = (e) => { popups.closeAll(); pb.send('fav:open', { url: h.url, disposition: e.metaKey ? 'background' : 'current' }); };
    row.addEventListener('auxclick', (e) => { if (e.button === 1) pb.send('fav:open', { url: h.url, disposition: 'background' }); });
    return row;
  }));
  placeUnder(histPanel, histBtn);
  histPanel.hidden = false;
  histBtn.classList.add('open');
}
histBtn.onclick = () => (popups.isOpen('history') ? popups.closeAll() : openHistory());
$('hp-more').onclick = () => { popups.closeAll(); pb.send('history:open-page'); };

// ---------- downloads ----------
const dlBtn = $('dl-btn'), dlPanel = $('dl-panel'), dlList = $('dl-list');
dlBtn.dataset.popupAnchor = '';
let items = [];

export function showDownloads(show) {
  if (show) {
    popups.register('downloads', () => { dlPanel.hidden = true; dlBtn.classList.remove('open'); if (!items.length) dlBtn.hidden = true; });
    dlBtn.hidden = false;
    placeUnder(dlPanel, dlBtn);
    dlPanel.hidden = false;
    dlBtn.classList.add('open');
  } else if (popups.isOpen('downloads')) popups.closeAll();
}
dlBtn.onclick = () => showDownloads(!popups.isOpen('downloads'));
$('dl-clear').onclick = () => pb.send('downloads:action', { id: null, action: 'clear' });
$('dl-close').onclick = () => showDownloads(false);

function actionBtn(label, d, action, id) {
  const b = document.createElement('button');
  b.className = 'icon'; b.title = label;
  b.innerHTML = `<svg viewBox="0 0 16 16"><path d="${d}"/></svg>`;
  b.onclick = (e) => { e.stopPropagation(); pb.send('downloads:action', { id, action }); };
  return b;
}
const P = { pause: 'M6 4v8M10 4v8', play: 'M5.5 3.5l7 4.5-7 4.5z', x: 'M4 4l8 8M12 4l-8 8',
  folder: 'M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z', retry: 'M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3' };

export function renderDownloads({ list, open }) {
  items = list;
  if (list.length) dlBtn.hidden = false;
  else if (!popups.isOpen('downloads')) dlBtn.hidden = true;
  const live = list.filter((d) => d.state === 'progressing');
  const total = live.reduce((a, d) => a + d.total, 0), got = live.reduce((a, d) => a + d.received, 0);
  dlBtn.classList.toggle('active', live.length > 0);
  dlBtn.style.setProperty('--p', `${total ? (got / total) * 100 : 8}%`);
  $('dl-empty').hidden = list.length > 0;
  dlList.replaceChildren(...list.map((d) => {
    const row = document.createElement('div');
    row.className = 'dl-row ' + d.state + (d.missing ? ' missing' : '');
    const icon = document.createElement('div');
    icon.className = 'dl-icon';
    icon.textContent = d.name.includes('.') ? d.name.split('.').pop().slice(0, 4) : '?';
    const info = document.createElement('div'); info.className = 'dl-info';
    info.append(Object.assign(document.createElement('div'), { className: 'dl-name', textContent: d.name, title: d.path }));
    const status = document.createElement('div'); status.className = 'dl-status';
    if (d.state === 'progressing') status.textContent = (d.total ? `${fmtBytes(d.received)} of ${fmtBytes(d.total)}` : fmtBytes(d.received)) + (d.paused ? ' · Paused' : '');
    else if (d.state === 'completed') status.textContent = d.missing ? 'Deleted' : fmtBytes(d.total || d.received);
    else status.textContent = d.state === 'cancelled' ? 'Cancelled' : 'Failed';
    info.append(status);
    if (d.state === 'progressing') {
      const bar = document.createElement('div'); bar.className = 'dl-bar';
      bar.style.setProperty('--w', d.total ? `${(d.received / d.total) * 100}%` : '30%');
      info.append(bar);
    }
    const actions = document.createElement('div'); actions.className = 'dl-actions';
    if (d.state === 'progressing') {
      actions.append(d.paused ? actionBtn('Resume', P.play, 'resume', d.id) : actionBtn('Pause', P.pause, 'pause', d.id),
        actionBtn('Cancel', P.x, 'cancel', d.id));
    } else {
      if (d.state === 'completed' && !d.missing) actions.append(actionBtn('Show in Finder', P.folder, 'show', d.id));
      if (d.state !== 'completed') actions.append(actionBtn('Retry', P.retry, 'retry', d.id));
      actions.append(actionBtn('Remove from list', P.x, 'remove', d.id));
    }
    row.append(icon, info, actions);
    if (d.state === 'completed' && !d.missing) row.onclick = () => pb.send('downloads:action', { id: d.id, action: 'open' });
    return row;
  }));
  if (open) showDownloads(true);
}
