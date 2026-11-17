// Cinema controls. Everything goes through the main process (cin:state / cin:cmd), which talks to the page.
const pb = window.pb;
const $ = (id) => document.getElementById(id);
const say = (t) => { $('msg').textContent = t; $('msg').hidden = false; clearTimeout(say.t); say.t = setTimeout(() => { $('msg').hidden = true; }, 3500); };
const cmd = (c, x, y) => pb.invoke('cin:cmd', c, x, y).then((r) => { if (r && r.error) say(r.error); else if (r && r.message) say(r.message); poll(); return r; }).catch(() => {});

// speed slider: 0.1× … 16× on a log scale (fine near 1×)
const RMIN = Math.log(0.1), RMAX = Math.log(16);
const toRate = (p) => { const r = Math.exp(RMIN + (RMAX - RMIN) * (p / 1000)); return r < 2 ? Math.round(r * 20) / 20 : Math.round(r * 4) / 4; };
const toPos = (r) => Math.round(((Math.log(r) - RMIN) / (RMAX - RMIN)) * 1000);
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8, 16];
const VOLS = [0, 0.5, 1, 1.5, 2, 3, 4];

let st = {}, seeking = false, panel = null, panelBusy = 0, idleT = 0, listKey = '';

let ticking = false;
async function poll() {
  if (ticking) return; ticking = true;
  const s = await pb.invoke('cin:state').catch(() => null);
  ticking = false;
  if (s && !s.error) { st = s; render(); }
}
setInterval(poll, 250);

function render() {
  document.body.classList.toggle('list', st.phase === 'list');
  document.body.classList.toggle('play', st.phase === 'play');
  $('loading').hidden = st.phase !== 'loading';
  $('title').textContent = st.title || 'Cinema';
  $('pin').classList.toggle('on', !!st.pinned);
  if (st.phase === 'list') return renderList();
  if (st.phase !== 'play') return;
  $('swap').textContent = st.mode === 'extract' ? 'EXTRACT ⇄' : 'DUPLICATE ⇄';
  $('swap').title = st.mode === 'extract' ? 'The tab is in Cinema. Switch to Duplicate: give the page back, play a copy here' : 'Playing a copy. Switch to Extract: move the tab itself here';
  $('play').textContent = st.paused ? '▶' : '❚❚';
  $('time').textContent = fmt(st.t); $('dur').textContent = st.d ? fmt(st.d) : 'live';
  const p = st.d ? st.t / st.d : 0;
  if (!seeking) $('seek').value = String(Math.round(p * 1000));
  $('fill').style.width = `${(seeking ? $('seek').value / 1000 : p) * 100}%`;
  const ab = st.a != null && st.d ? [st.a / st.d, (st.b != null ? st.b : st.t) / st.d] : null;
  $('ab').hidden = !ab; if (ab) { $('ab').style.left = `${ab[0] * 100}%`; $('ab').style.width = `${Math.max(0, ab[1] - ab[0]) * 100}%`; }
  $('a').classList.toggle('on', st.a != null); $('b').classList.toggle('on', st.b != null);
  $('ratev').textContent = `${+(st.rate || 1).toFixed(2)}×`;
  $('volv').textContent = `${Math.round((st.vol ?? 1) * 100)}%`;
  if (document.activeElement !== $('op')) $('op').value = String(Math.round((st.opacity || 1) * 100));
  const canSave = st.file || st.stream;
  $('dl').style.opacity = canSave || st.saving != null ? 1 : 0.4; // still clickable: it says why when there's nothing to save
  $('dl').textContent = st.saving != null ? `${st.saving}%` : '⤓';
  $('dl').classList.toggle('on', st.saving != null);
  $('dl').title = st.saving != null ? 'Saving to Downloads — click to stop' : st.file ? 'Save the video file to Downloads'
    : st.stream ? 'Save this stream as one video file in Downloads' : 'Nothing to save here';
  if (st.saveNote && st.saveNote !== render.note) say(st.saveNote);
  render.note = st.saveNote;
  if (panel && Date.now() > panelBusy) fillPanel();
}

function renderList() {
  $('note').hidden = !st.note; $('note').textContent = st.note || '';
  const vids = st.videos || [];
  $('none').hidden = !!vids.length;
  $('none').textContent = st.web === false ? 'Cinema works on web pages — open one with a video.' : 'No videos yet — they’ll show up here as the page loads.';
  const key = JSON.stringify(vids.map((v) => [v.fid, v.i, v.src, v.w, v.h, Math.round(v.d), v.paused, !!v.thumb, Math.floor(v.t / 5)]));
  if (key === listKey) return;
  listKey = key;
  $('videos').replaceChildren(...vids.map((v, n) => {
    const el = document.createElement('div'); el.className = 'vid';
    const th = document.createElement('div'); th.className = 'thumb';
    if (v.thumb) th.style.backgroundImage = `url("${v.thumb}")`; else th.textContent = '▶';
    let host = ''; try { host = v.src.startsWith('blob:') ? 'streamed' : new URL(v.src).hostname; } catch { host = v.src ? '' : 'not loaded yet'; }
    if (v.inFrame) host = `in a player from ${v.frameHost}`;
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.innerHTML = '<div class="t1"></div><div class="t2"></div><div class="acts"></div>';
    meta.querySelector('.t1').textContent = `Video ${n + 1}${v.paused ? '' : ' · playing'}`;
    meta.querySelector('.t2').textContent = [v.w && v.h ? `${v.w}×${v.h}` : '', v.d ? fmt(v.d) : (v.ready ? 'live' : ''), host].filter(Boolean).join(' · ');
    const ex = Object.assign(document.createElement('button'), { className: 'ic go', textContent: 'Extract', title: 'Move the tab itself into Cinema' });
    const du = Object.assign(document.createElement('button'), { className: 'ic', textContent: 'Duplicate', title: 'Play a copy here; the page stays as it is' });
    ex.onclick = () => cmd('pick', { fid: v.fid, i: v.i }, 'extract');
    du.onclick = () => cmd('pick', { fid: v.fid, i: v.i }, 'duplicate');
    meta.querySelector('.acts').append(ex, du);
    el.append(th, meta);
    return el;
  }));
}

// ---------- the big speed / volume panel (hover the icon) ----------
function fillPanel() {
  const r = $('bigr');
  if (panel === 'rate') {
    r.min = 0; r.max = 1000; r.step = 1; r.value = String(toPos(st.rate || 1));
    $('bigv').textContent = `${+(st.rate || 1).toFixed(2)}×`; $('bigv').classList.remove('boost');
  } else {
    r.min = 0; r.max = 400; r.step = 5; r.value = String(Math.round((st.vol ?? 1) * 100));
    $('bigv').textContent = `${r.value}%`; $('bigv').classList.toggle('boost', r.value > 100);
  }
  const values = panel === 'rate' ? RATES : VOLS;
  const want = values.map((x) => (panel === 'rate' ? `${x}×` : `${x * 100}%`)).join();
  if ($('chips').dataset.k !== want) {
    $('chips').dataset.k = want;
    $('chips').replaceChildren(...values.map((x) => Object.assign(document.createElement('button'), {
      className: 'ic', textContent: panel === 'rate' ? `${x}×` : `${x * 100}%`, onclick: () => setVal(x) })));
  }
}
function setVal(x) {
  panelBusy = Date.now() + 400;
  if (panel === 'rate') { st.rate = x; cmd('rate', x); } else { st.vol = x; cmd('vol', x); }
  fillPanel();
}
function openPanel(which) { clearTimeout(openPanel.t); panel = which; $('big').hidden = false; for (const k of document.querySelectorAll('.knob')) k.classList.toggle('hot', k.dataset.panel === which); fillPanel(); }
function closePanelSoon() { clearTimeout(openPanel.t); openPanel.t = setTimeout(() => { if (!document.querySelector('#big:hover, .knob:hover')) { panel = null; $('big').hidden = true; for (const k of document.querySelectorAll('.knob')) k.classList.remove('hot'); } }, 300); }
for (const k of document.querySelectorAll('.knob')) {
  k.addEventListener('mouseenter', () => openPanel(k.dataset.panel));
  k.addEventListener('mouseleave', closePanelSoon);
  k.addEventListener('click', () => openPanel(k.dataset.panel));
  k.addEventListener('wheel', (e) => { e.preventDefault(); openPanel(k.dataset.panel); nudge(e.deltaY < 0); }, { passive: false });
}
$('big').addEventListener('mouseenter', () => clearTimeout(openPanel.t));
$('big').addEventListener('mouseleave', closePanelSoon);
$('big').addEventListener('wheel', (e) => { e.preventDefault(); nudge(e.deltaY < 0); }, { passive: false });
$('bigr').addEventListener('input', () => setVal(panel === 'rate' ? toRate(Number($('bigr').value)) : Number($('bigr').value) / 100));
function nudge(up) {
  if (panel === 'rate') { const r = st.rate || 1; const n = up ? RATES.find((x) => x > r + 1e-3) : [...RATES].reverse().find((x) => x < r - 1e-3); if (n) setVal(n); }
  else { setVal(Math.max(0, Math.min(4, Math.round(((st.vol ?? 1) + (up ? 0.1 : -0.1)) * 10) / 10))); }
}

// ---------- buttons and keys ----------
$('play').onclick = () => cmd('play');
$('hit').onclick = () => cmd('play');
$('back10').onclick = () => cmd('skip', -10);
$('fwd10').onclick = () => cmd('skip', 10);
$('fprev').onclick = () => cmd('frame', -1);
$('fnext').onclick = () => cmd('frame', 1);
$('a').onclick = () => cmd('a');
$('b').onclick = () => cmd('b');
$('pin').onclick = () => cmd('pin');
$('close').onclick = () => cmd('close');
$('swap').onclick = () => cmd('swap');
$('tolist').onclick = () => cmd('list');
$('dl').onclick = () => cmd('download');
$('seek').addEventListener('input', () => { seeking = true; render(); });
$('seek').addEventListener('change', () => { seeking = false; if (st.d) cmd('seek', ($('seek').value / 1000) * st.d); });
$('op').addEventListener('input', () => cmd('opacity', Number($('op').value) / 100));
document.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === 'Escape') { if (panel) { panel = null; $('big').hidden = true; } else cmd('close'); return; }
  if (st.phase !== 'play') return;
  if (k === ' ' || k === 'k') { e.preventDefault(); cmd('play'); }
  else if (k === 'ArrowLeft') cmd('skip', e.shiftKey ? -30 : -5);
  else if (k === 'ArrowRight') cmd('skip', e.shiftKey ? 30 : 5);
  else if (k === 'ArrowUp' || k === 'ArrowDown') { const was = panel; panel = 'rate'; nudge(k === 'ArrowUp'); panel = was; say(`Speed ${+(st.rate || 1).toFixed(2)}×`); }
  else if (k === ',') cmd('frame', -1);
  else if (k === '.') cmd('frame', 1);
  else if (k === 'a' || k === 'A') cmd('a');
  else if (k === 'b' || k === 'B') cmd('b');
  wake();
});
function wake() {
  document.body.classList.remove('idle'); clearTimeout(idleT);
  idleT = setTimeout(() => { if (!panel && !document.querySelector('#bar:hover, #top:hover')) document.body.classList.add('idle'); }, 2200);
}
document.addEventListener('mousemove', wake);
wake();
poll();
