// Hex Injector window: write, organize and run your own JavaScript / CSS / HTML scripts.
// Everything goes through the main process (validated there); this page never touches web pages itself.
const pb = window.pb;
const $ = (id) => document.getElementById(id);
const call = async (ch, ...a) => { const r = await pb.invoke(ch, ...a); if (r && r.error) throw new Error(r.error); return r; };

let scripts = [], langs = {}, cur = null, filter = '', runFilter = '', runMode = 'manual', dirty = false;

function status(text, kind = '') { $('status').textContent = text; $('status').className = `status ${kind}`; }

async function load(selectId) {
  const r = await call('hexs:list');
  scripts = r.scripts; langs = r.langs;
  if (!$('lang').options.length) $('lang').append(...Object.entries(langs).map(([v, t]) => Object.assign(document.createElement('option'), { value: v, textContent: t })));
  renderList();
  const id = selectId ?? cur?.id;
  if (id) { const s = scripts.find((x) => x.id === id); if (s && !dirty) open(s); }
}

function renderList() {
  const q = $('search').value.trim().toLowerCase();
  for (const b of $('chips').children) b.classList.toggle('on', b.dataset.l === filter);
  for (const b of $('runchips').children) b.classList.toggle('on', b.dataset.r === runFilter);
  const shown = scripts.filter((s) => (!filter || s.lang === filter) && (!runFilter || s.run === runFilter) && (!q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)));
  const rows = (list) => list.map((s) => {
    const row = document.createElement('div');
    row.className = 'row' + (cur && cur.id === s.id ? ' sel' : '');
    if (s.favorite) row.append(Object.assign(document.createElement('span'), { className: 'star', textContent: '★' }));
    row.append(Object.assign(document.createElement('span'), { className: 'nm', textContent: s.name, title: s.description }));
    if (s.example) row.append(Object.assign(document.createElement('span'), { className: 'ex', textContent: 'example' }));
    if (s.run === 'auto') row.append(Object.assign(document.createElement('span'), { className: 'auto', textContent: 'auto', title: `Runs by itself on ${s.sites.join(', ')}` }));
    row.append(Object.assign(document.createElement('span'), { className: `badge ${s.lang}`, textContent: s.lang }));
    row.onclick = () => { if (!dirty || confirm('Discard unsaved changes?')) { dirty = false; open(s); } };
    return row;
  });
  const sec = (t) => Object.assign(document.createElement('div'), { className: 'sec', textContent: t });
  const man = shown.filter((s) => s.run !== 'auto'), aut = shown.filter((s) => s.run === 'auto');
  $('list').replaceChildren(...(man.length && aut.length ? [sec('Manual'), ...rows(man), sec('Automatic'), ...rows(aut)] : rows(shown)));
}

function open(s) {
  cur = s;
  $('empty').hidden = true; $('form').hidden = false;
  $('name').value = s.name || ''; $('desc').value = s.description || ''; $('lang').value = s.lang || 'js';
  $('code').value = s.code || ''; $('sites').value = (s.sites || []).join('\n');
  setRunMode(s.run || 'manual');
  $('fav').textContent = s.favorite ? '★' : '☆'; $('fav').classList.toggle('on', !!s.favorite);
  $('del').hidden = !s.id; $('dup').hidden = !s.id;
  dirty = false; status('');
  renderList(); target();
}

const form = () => ({ id: cur?.id || 0, name: $('name').value, description: $('desc').value, lang: $('lang').value,
  code: $('code').value, sites: $('sites').value, run: runMode, favorite: !!cur?.favorite });

function setRunMode(m) {
  runMode = m;
  for (const b of $('runmode').children) b.classList.toggle('on', b.dataset.v === m);
  const auto = m === 'auto';
  $('sites-sum').textContent = auto ? 'Runs on these sites (needed)' : 'Only on these sites';
  $('sites').placeholder = auto ? 'example.com\n*.example.org' : 'example.com\n*.example.org\n(empty = any web page)';
  if (auto) $('sites-box').open = true;
}

async function save() {
  try {
    const r = await call('hexs:save', form());
    dirty = false; cur = r.script;
    await load(r.script.id);
    status('Saved', 'ok');
    return r.script;
  } catch (e) { status(e.message, 'err'); return null; }
}

async function run() {
  const s = dirty || !cur?.id ? await save() : cur;
  if (!s) return;
  try { status((await call('hexs:run', s.id)).message, 'ok'); } catch (e) { status(e.message, 'err'); }
}

async function target() {
  const t = await call('hexs:target').catch(() => null);
  $('target').textContent = t && t.title ? `Runs on: ${t.title}` : 'No tab to run on';
  $('target').title = t?.url || '';
  $('run').disabled = !t || !t.web;
  if (t && !t.web) $('target').textContent = 'Runs on web pages only';
}

$('new').onclick = () => { if (!dirty || confirm('Discard unsaved changes?')) open({ lang: filter || 'js', run: runFilter || 'manual', name: '', code: '' }); $('name').focus(); };
$('form').addEventListener('submit', (e) => { e.preventDefault(); save(); });
$('run').onclick = run;
$('dup').onclick = async () => { try { const r = await call('hexs:dup', cur.id); await load(r.script.id); status('Duplicated', 'ok'); } catch (e) { status(e.message, 'err'); } };
$('del').onclick = async () => {
  if (!confirm(`Delete “${cur.name}”? This can’t be undone.`)) return;
  await call('hexs:delete', cur.id); cur = null; dirty = false;
  $('form').hidden = true; $('empty').hidden = false; load();
};
$('fav').onclick = async () => {
  if (!cur?.id) { cur = { ...form(), favorite: !cur?.favorite }; $('fav').textContent = cur.favorite ? '★' : '☆'; return; }
  const r = await call('hexs:fav', cur.id, !cur.favorite); cur = { ...cur, favorite: r.script.favorite };
  $('fav').textContent = cur.favorite ? '★' : '☆'; $('fav').classList.toggle('on', cur.favorite); load();
};
$('pin').onclick = async () => { const r = await call('hexs:pin', !$('pin').classList.contains('on')); $('pin').classList.toggle('on', r.pinned); };
for (const id of ['name', 'desc', 'code', 'sites', 'lang']) $(id).addEventListener('input', () => { dirty = true; status('Not saved'); });
$('search').addEventListener('input', renderList);
for (const b of $('chips').children) b.onclick = () => { filter = b.dataset.l; renderList(); };
for (const b of $('runchips').children) b.onclick = () => { runFilter = b.dataset.r; renderList(); };
for (const b of $('runmode').children) b.onclick = () => { if (runMode !== b.dataset.v) { setRunMode(b.dataset.v); dirty = true; status('Not saved'); } };
$('code').addEventListener('keydown', (e) => {
  if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
});
document.addEventListener('keydown', (e) => {
  const mod = /Mac/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
  if (mod && e.key === 's') { e.preventDefault(); if (!$('form').hidden) save(); }
  if (mod && e.key === 'Enter') { e.preventDefault(); if (!$('form').hidden) run(); }
});
window.addEventListener('focus', target);
pb.on('hexs:changed', () => load());
load();
