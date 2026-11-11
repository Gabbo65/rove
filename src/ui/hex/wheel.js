// Hex wheel: its own small always-on-top window, opened at the mouse (Hex Trigger, default ⌥H / Alt+H),
// also outside Rove's window. Hex Mode: Smooth (hover opens families and groups, click runs) or Bumpy (all clicks).
// Entering a family or group re-centres the wheel on the cursor.
// Root: four families. Moving toward one ENTERS it: the wheel turns into that family's ring. Groups open a
// deeper ring; the centre button always goes back one level. Moving only enters/highlights — a click or Enter
// runs. Settings are changed right here (Trigger recorder, Color ring) — no trip to Rove's Settings page.
// It only shows what the main process's Hex core sends and asks it to run items by id (never code).
const pb = window.pb;

const R = 104, HOLE = 34;   // wheel radius and centre button (px)
const DEAD = 20;            // px around the centre where moving picks nothing
const ICONS = {
  injector: '<path d="M14.5 3.5l6 6M17.5 6.5l-9 9-3.5 1 1-3.5 9-9M10 12l2 2M3.5 20.5l3-3"/>',
  magic: '<path d="M4 20L14.5 9.5"/><path d="M15 3l.9 2.1L18 6l-2.1.9L15 9l-.9-2.1L12 6l2.1-.9zM19.5 11l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z"/>',
  options: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/><circle cx="12" cy="12" r="6.5"/>',
  extract: '<path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/><path d="M13 4h7v7M20 4l-9 9"/>',
  key: '<rect x="2.5" y="6.5" width="19" height="11" rx="2"/><path d="M6 10h1M9 10h1M12 10h1M15 10h1M18 10h0M7 14h10"/>',
  color: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1-.8-1.4-.8-2.4 0-.9.7-1.5 1.6-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  item: '<circle cx="12" cy="12" r="2.5"/>',
  mode: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  smooth: '<path d="M3 14c3-6 6-6 9 0s6 6 9 0"/>',
  size: '<path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6"/>',
  'size-small': '<circle cx="12" cy="12" r="3.5"/>',
  'size-normal': '<circle cx="12" cy="12" r="6"/>',
  'size-large': '<circle cx="12" cy="12" r="8.5"/>',
  'lang-js': '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
  'lang-css': '<path d="M7 4c-2 0-2 2-2 4s-1 4-2 4c1 0 2 2 2 4s0 4 2 4M17 4c2 0 2 2 2 4s1 4 2 4c-1 0-2 2-2 4s0 4-2 4"/>',
  'lang-html': '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5M13 5l-2 14"/>',
  edit: '<path d="M14.5 4.5l5 5L9 20H4v-5z"/><path d="M12.5 6.5l5 5"/>',
  bumpy: '<path d="M3 16h4V9h5v7h4V7h5"/>',
};
const ROOT_ANGLES = [[180, 270], [270, 360], [90, 180], [0, 90]]; // top-left, top-right, bottom-left, bottom-right

const root = document.createElement('div');
root.id = 'hex';
root.hidden = true;
root.tabIndex = -1;
root.setAttribute('role', 'dialog');
root.setAttribute('aria-label', 'Hex');
document.body.append(root);

let state = 'closed';       // closed · ring · recording · running
let families = [];
let path = [];              // ids from the root: [] = the four families; ['options'] ; ['options', 'hex.color'] …
let nodes = [];             // what the current ring shows
let sel = -1;
let angles = [];
let mode = 'smooth';  // smooth · bumpy

const pt = (deg, r) => { const a = (deg * Math.PI) / 180; return [R + r * Math.cos(a), R + r * Math.sin(a)]; };
function sectorPath([a0, a1], gap = 3) {
  const ro = R - 2, ri = HOLE + 6;
  if (a1 - a0 >= 359) return `M${R} ${R - ro}A${ro} ${ro} 0 1 1 ${R - 0.01} ${R - ro}ZM${R} ${R - ri}A${ri} ${ri} 0 1 0 ${R + 0.01} ${R - ri}Z`;
  const large = a1 - a0 - 2 * gap > 180 ? 1 : 0;
  const [x0, y0] = pt(a0 + gap, ro), [x1, y1] = pt(a1 - gap, ro), [x2, y2] = pt(a1 - gap, ri), [x3, y3] = pt(a0 + gap, ri);
  return `M${x0} ${y0}A${ro} ${ro} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${ri} ${ri} 0 ${large} 0 ${x3} ${y3}Z`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const short = (s, n = 13) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function find(ids) {
  let list = families.map((f) => ({ ...f, kind: 'family', icon: f.id }));
  let cur = null;
  for (const id of ids) { cur = list.find((n) => n.id === id); if (!cur) return null; list = cur.items || []; }
  return cur;
}

function draw() {
  const here = find(path);
  nodes = here ? here.items || [] : families.map((f) => ({ ...f, kind: 'family', icon: f.id }));
  const atRoot = !path.length;
  const shown = nodes.length ? nodes : [{ id: '', icon: here.icon, name: here.name, dim: true }];
  const n = shown.length;
  angles = atRoot ? ROOT_ANGLES : shown.map((_, i) => [-90 + (360 / n) * (i - 0.5), -90 + (360 / n) * (i + 0.5)]);
  const g = shown.map((s, i) => {
    const mid = (angles[i][0] + angles[i][1]) / 2;
    const [ix, iy] = n === 1 ? [R, R - (R + HOLE) / 2 - 2] : pt(mid, (R + HOLE) / 2 + 2);
    const swatch = s.color ? ` style="--sw:${s.color}"` : '';
    const icon = s.color ? (s.on ? ICONS.check : '') : ICONS[s.icon] || ICONS.item;
    return `<g class="hx-sector${s.dim ? ' dim' : ''}${s.color ? ' swatch' : ''}${s.on ? ' cur' : ''}" data-i="${i}" role="button" aria-label="${esc(s.name)}"${swatch}>
      <path d="${sectorPath(angles[i], n === 1 ? 0 : 3)}" fill-rule="evenodd"/>
      <svg class="hx-icon" x="${ix - 13}" y="${iy - 19}" width="26" height="26" viewBox="0 0 24 24">${icon}</svg>
      ${s.color ? '' : `<text x="${ix}" y="${iy + 20}">${esc(short(s.name))}</text>`}</g>`;
  }).join('');
  root.innerHTML = `<svg class="hx-wheel" width="${R * 2}" height="${R * 2}" viewBox="0 0 ${R * 2} ${R * 2}">${g}
      <g class="hx-hub${atRoot ? '' : ' back'}" role="button" aria-label="${atRoot ? 'Close' : 'Back'}">
        <circle cx="${R}" cy="${R}" r="${HOLE}"/>
        ${atRoot ? `<circle class="hx-core" cx="${R}" cy="${R}" r="7"/>`
          : `<svg class="hx-icon" x="${R - 11}" y="${R - 11}" width="22" height="22" viewBox="0 0 24 24">${ICONS.back}</svg>`}</g></svg>
    <div class="hx-caption"></div>`;
  if (atRoot) caption('', '');
  else caption(here.name, nodes.length ? (here.kind === 'family' ? '' : here.description) : here.empty || 'Nothing here yet.');
  root.classList.remove('morph'); void root.offsetWidth; root.classList.add('morph');
  for (const el of root.querySelectorAll('.hx-sector')) {
    el.addEventListener('mouseenter', () => hover(Number(el.dataset.i)));
    el.addEventListener('click', () => choose(Number(el.dataset.i)));
  }
  root.querySelector('.hx-hub').addEventListener('click', () => (path.length ? back() : close()));
  sel = -1;
  state = 'ring';
}

function caption(title, text, err = false) {
  const c = root.querySelector('.hx-caption');
  if (!c) return;
  c.innerHTML = title || text ? `<b${err ? ' class="err"' : ''}>${esc(title || '')}</b><span>${esc(text || '')}</span>` : '';
}

function highlight(i) {
  if (state !== 'ring' || !nodes[i]) return;
  sel = i;
  root.querySelectorAll('.hx-sector').forEach((g, k) => g.classList.toggle('on', k === i));
  if (path.length) caption(nodes[i].name, nodes[i].description);
}

// Smooth: hovering a family or group opens it; hovering a command only shows it. Bumpy: hovering only shows.
function hover(i) {
  const n = nodes[i];
  if (state !== 'ring' || !n) return;
  if (mode === 'smooth' && (n.kind === 'family' || n.kind === 'group')) choose(i); else highlight(i);
}

function choose(i) {
  const n = nodes[i];
  if (state !== 'ring' || !n) return;
  if (n.kind === 'family' || n.kind === 'group') {
    path.push(n.id); draw(); root.focus({ preventScroll: true });
    pb.invoke('hex:recenter').catch(() => {}); // follow the mouse: the next ring opens right where you are
  }
  else if (n.kind === 'key') record(n);
  else runItem(n);
}

async function runItem(it) {
  state = 'running';
  const r = await pb.invoke('hex:run', it.id).catch((e) => ({ error: String(e.message || e) }));
  if (r && r.error) { state = 'ring'; caption('Didn’t work', r.error, true); return; }
  if (r && r.stay) { refresh(r); return; } // a setting changed: stay here, show it
  close();
}

function refresh(r) {
  if (r.families) families = r.families;
  if (r.color) root.dataset.color = r.color;
  if (r.mode) mode = r.mode;
  const keep = sel;
  draw();
  if (keep >= 0) highlight(keep);
}

// Trigger recorder: the next key combination becomes the Hex Trigger.
function record(n) {
  state = 'recording';
  root.classList.add('recording');
  caption(n.name, 'Press the new shortcut… (Esc cancels)');
}
const MAC = /Mac/.test(navigator.platform);
function accelerator(e) {
  const c = e.code;
  const key = /^Key[A-Z]$/.test(c) ? c.slice(3) : /^Digit\d$/.test(c) ? c.slice(5) : /^F\d{1,2}$/.test(c) ? c
    : { Space: 'Space', Backquote: 'Backquote', Period: 'Period', Comma: 'Comma', Slash: 'Slash' }[c];
  if (!key) return '';
  return [MAC ? e.metaKey && 'CmdOrCtrl' : e.ctrlKey && 'CmdOrCtrl', MAC && e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', key]
    .filter(Boolean).join('+');
}
async function onRecordKey(e) {
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'Escape') { root.classList.remove('recording'); state = 'ring'; caption('Trigger', 'Not changed'); return; }
  const acc = accelerator(e);
  if (!acc) return; // only modifiers so far
  const r = await pb.invoke('hex:set', 'hexTrigger', acc).catch((err) => ({ error: String(err.message || err) }));
  root.classList.remove('recording');
  state = 'ring';
  if (r.error) caption('Trigger', r.error, true);
  else { if (r.families) families = r.families; caption('Trigger', `Now ${label(acc)}`); }
}
function label(acc) {
  const map = MAC ? { CmdOrCtrl: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' } : { CmdOrCtrl: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift' };
  return acc.split('+').map((p) => map[p] || p).join(MAC ? '' : '+');
}

function back() { path.pop(); draw(); root.focus({ preventScroll: true }); pb.invoke('hex:recenter').catch(() => {}); }

// Moving away from the centre: on the root wheel it enters that family; deeper it only highlights.
// Only real movement counts: the first event after opening just marks where the mouse is. (Near a screen edge
// the wheel is pushed inward, so the resting mouse may sit over a family — it must not enter it by itself.)
let rest = null;
document.addEventListener('mousemove', (e) => {
  if (state !== 'ring') return;
  if (!rest) { rest = { x: e.screenX, y: e.screenY, armed: false }; return; }
  if (!rest.armed) { if (Math.hypot(e.screenX - rest.x, e.screenY - rest.y) < 8) return; rest.armed = true; }
  const r = root.getBoundingClientRect();
  const dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
  const d = Math.hypot(dx, dy);
  if (d < DEAD || d > R + 40) return;
  const a = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  const i = angles.findIndex(([a0, a1]) => { const x = ((a - a0) % 360 + 360) % 360; return x < a1 - a0; });
  if (i < 0 || !nodes[i] || i === sel) return;
  hover(i);
}, true);

function open({ families: fams, color, mode: m }) {
  families = Array.isArray(fams) ? fams : [];
  root.dataset.color = color || 'violet';
  mode = m === 'bumpy' ? 'bumpy' : 'smooth';
  path = [];
  rest = null;
  root.hidden = false;
  draw();
  root.focus({ preventScroll: true });
}
function hide() { root.hidden = true; state = 'closed'; path = []; sel = -1; root.classList.remove('recording'); }
function close() { if (state !== 'closed') { hide(); pb.invoke('hex:close').catch(() => {}); } }
pb.on('hex:open', open);
pb.on('hex:closed', hide);

// Keyboard: 1–4 / arrows enter a family; deeper ←/→ pick, Enter runs or opens, Esc / Backspace go back, Esc on top closes.
root.addEventListener('keydown', (e) => {
  if (state === 'recording') return onRecordKey(e);
  if (state === 'closed') return;
  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); if (path.length) back(); else close(); return; }
  if (state !== 'ring') return;
  if (!path.length) {
    const i = /^[1-4]$/.test(k) ? Number(k) - 1 : { ArrowUp: 0, ArrowLeft: 0, ArrowRight: 1, ArrowDown: 3 }[k];
    if (i !== undefined) { e.preventDefault(); choose(i); if (nodes.length) highlight(0); }
    return;
  }
  const n = nodes.length;
  if (/^Arrow/.test(k) && n) { e.preventDefault(); highlight(((sel < 0 ? -1 : sel) + (k === 'ArrowLeft' || k === 'ArrowUp' ? n - 1 : 1)) % n); }
  else if (k === 'Enter' && sel >= 0) { e.preventDefault(); choose(sel); }
  else if (k === 'Backspace') { e.preventDefault(); back(); }
});
