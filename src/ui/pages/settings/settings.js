// Settings page. Every control writes through the main process (validated there) and re-renders from its answer.
const $ = (id) => document.getElementById(id);
const call = (name, ...a) => window.pb.call(name, ...a);
let S = {};

// ---------- generic bindings ----------
function render(settings) {
  S = settings;
  for (const el of document.querySelectorAll('[data-setting]')) el.checked = !!S[el.dataset.setting];
  for (const r of document.querySelectorAll('input[name=startPage]')) r.checked = r.value === S.startPage;
  $('startUrl').hidden = S.startPage !== 'url';
  if (document.activeElement !== $('startUrl')) $('startUrl').value = S.startUrl || '';
  for (const b of $('theme').children) b.classList.toggle('on', b.dataset.v === S.theme);
  $('searchEngine').value = S.searchEngine;
  $('custom-box').hidden = S.searchEngine !== 'custom';
  if (S.searchEngine === 'custom' && !$('custom-box').contains(document.activeElement)) {
    $('custom-name').value = S.customSearch?.name || '';
    $('custom-url').value = S.customSearch?.url || '';
    $('custom-suggest').value = S.customSearch?.suggestUrl || '';
  }
  $('sleepAfterMinutes').value = String(S.sleepAfterMinutes);
  $('sleepAfterMinutes').disabled = !S.sleepingTabs;
  $('dl-reset').hidden = !S.downloadDir;
}
const set = async (patch) => render(await call('set', patch));

for (const el of document.querySelectorAll('[data-setting]')) el.addEventListener('change', () => set({ [el.dataset.setting]: el.checked }));
for (const r of document.querySelectorAll('input[name=startPage]')) r.addEventListener('change', () => set({ startPage: r.value }));
$('startUrl').addEventListener('change', async () => {
  let v = $('startUrl').value.trim();
  if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
  const before = S.startUrl;
  await set({ startUrl: v });
  const ok = S.startUrl === v;
  $('startUrl').classList.toggle('bad', !ok);
  $('startUrl-hint').textContent = ok ? '' : 'That doesn’t look like a web address';
  if (!ok) S.startUrl = before;
});
for (const b of $('theme').children) b.onclick = () => set({ theme: b.dataset.v });
$('searchEngine').addEventListener('change', () => set({ searchEngine: $('searchEngine').value }));
$('custom-save').onclick = async () => {
  const c = { name: $('custom-name').value.trim(), url: $('custom-url').value.trim(), suggestUrl: $('custom-suggest').value.trim() };
  const s = await call('set', { customSearch: c });
  const ok = JSON.stringify(s.customSearch) === JSON.stringify(c);
  $('custom-hint').textContent = ok ? 'Saved' : 'Addresses must start with https:// and contain %s';
  render(s);
};
$('sleepAfterMinutes').addEventListener('change', () => set({ sleepAfterMinutes: Number($('sleepAfterMinutes').value) }));

// ---------- downloads ----------
$('dl-change').onclick = async () => { $('dl-folder').textContent = await call('chooseDownloadDir'); };
$('dl-reset').onclick = async () => { await set({ downloadDir: '' }); load(); };

// ---------- passwords ----------
let pwItems = [];
async function loadPasswords() {
  const data = await call('passwords');
  pwItems = data.items;
  $('enc-warn').hidden = data.encryption;
  renderPasswords();
  $('never-card').hidden = !data.never.length;
  $('never-list').replaceChildren(...data.never.map((origin) => {
    const row = document.createElement('div'); row.className = 'row item';
    const site = document.createElement('div'); site.className = 'site';
    site.append(Object.assign(document.createElement('div'), { className: 'label', textContent: origin.replace(/^https?:\/\//, '') }));
    const del = Object.assign(document.createElement('button'), { className: 'btn', textContent: 'Remove' });
    del.onclick = () => call('removeNever', origin);
    row.append(site, del);
    return row;
  }));
}
function renderPasswords() {
  const q = $('pw-search').value.trim().toLowerCase();
  const items = pwItems.filter((p) => !q || p.origin.toLowerCase().includes(q) || p.username.toLowerCase().includes(q));
  $('pw-empty').hidden = items.length > 0;
  $('pw-empty').textContent = pwItems.length ? 'No matches' : 'No saved passwords yet';
  $('pw-list').replaceChildren(...items.map((p) => {
    const row = $('pw-row').content.firstElementChild.cloneNode(true);
    row.dataset.id = p.id;
    row.querySelector('.origin').textContent = p.origin.replace(/^https?:\/\//, '');
    row.querySelector('.user').textContent = p.username || '(no username)';
    const secret = row.querySelector('.secret');
    row.querySelector('.reveal').onclick = async () => {
      if (secret.dataset.shown) { secret.textContent = '••••••••'; delete secret.dataset.shown; return; }
      const pw = await call('revealPassword', p.id);
      if (pw != null) { secret.textContent = pw; secret.dataset.shown = '1'; }
    };
    row.querySelector('.copy').onclick = async () => { if (await call('copyPassword', p.id)) flash(row.querySelector('.copy'), '✓'); };
    row.querySelector('.del').onclick = () => { if (confirm(`Delete the saved password for ${p.username || 'this account'} on ${row.querySelector('.origin').textContent}?`)) call('deletePassword', p.id); };
    row.querySelector('.edit').onclick = () => editPassword(row, p);
    return row;
  }));
}
function editPassword(row, p) {
  if (row.nextElementSibling?.classList.contains('editor')) { row.nextElementSibling.remove(); return; }
  const ed = document.createElement('div'); ed.className = 'editor';
  const user = Object.assign(document.createElement('input'), { className: 'field', value: p.username, placeholder: 'Username' });
  const pass = Object.assign(document.createElement('input'), { className: 'field', type: 'password', placeholder: 'New password (leave empty to keep)' });
  const actions = document.createElement('div'); actions.className = 'actions';
  const save = Object.assign(document.createElement('button'), { className: 'btn primary', textContent: 'Save' });
  const cancel = Object.assign(document.createElement('button'), { className: 'btn', textContent: 'Cancel' });
  cancel.onclick = () => ed.remove();
  save.onclick = async () => { if (await call('updatePassword', { id: p.id, username: user.value, password: pass.value || undefined })) ed.remove(); };
  actions.append(cancel, save);
  ed.append(user, pass, actions);
  row.after(ed);
  user.focus();
}
$('pw-search').addEventListener('input', renderPasswords);
function flash(btn, text) { const t = btn.textContent; btn.textContent = text; setTimeout(() => { btn.textContent = t; }, 1200); }

// ---------- form profiles ----------
const PF = [['name', 'Full name'], ['email', 'Email'], ['tel', 'Phone'], ['organization', 'Company'],
  ['street-address', 'Street address'], ['address-level2', 'City'], ['postal-code', 'Postal code'], ['country', 'Country']];
async function loadProfiles() {
  const list = await call('profiles');
  $('pf-empty').hidden = list.length > 0;
  $('pf-list').replaceChildren(...list.map((p) => {
    const row = document.createElement('div'); row.className = 'row item';
    const site = document.createElement('div'); site.className = 'site';
    site.append(Object.assign(document.createElement('div'), { className: 'label', textContent: p.name || p.email || 'Address' }),
      Object.assign(document.createElement('div'), { className: 'hint', textContent: [p.email, p['street-address'], p['address-level2'], p.tel].filter(Boolean).join(' · ') }));
    const actions = document.createElement('div'); actions.className = 'actions';
    const edit = Object.assign(document.createElement('button'), { className: 'icon', textContent: '✎', title: 'Edit' });
    const del = Object.assign(document.createElement('button'), { className: 'icon', textContent: '✕', title: 'Delete' });
    edit.onclick = () => editProfile(row, p);
    del.onclick = () => { if (confirm('Delete this address?')) call('deleteProfile', p.id); };
    actions.append(edit, del);
    row.append(site, actions);
    return row;
  }));
}
function editProfile(after, p = {}) {
  document.querySelectorAll('#forms .editor').forEach((e) => e.remove());
  const ed = document.createElement('div'); ed.className = 'editor';
  const inputs = {};
  for (const [k, label] of PF) {
    inputs[k] = Object.assign(document.createElement('input'), { className: 'field', placeholder: label, value: p[k] || '' });
    ed.append(inputs[k]);
  }
  const actions = document.createElement('div'); actions.className = 'actions';
  const save = Object.assign(document.createElement('button'), { className: 'btn primary', textContent: 'Save' });
  const cancel = Object.assign(document.createElement('button'), { className: 'btn', textContent: 'Cancel' });
  cancel.onclick = () => ed.remove();
  save.onclick = async () => {
    const data = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
    await call('saveProfile', p.id ? { id: p.id, ...data } : data);
    ed.remove();
    loadProfiles();
  };
  actions.append(cancel, save);
  ed.append(actions);
  after.after(ed);
  inputs.name.focus();
}
$('pf-add').onclick = () => editProfile($('pf-add').parentElement.previousElementSibling);

// ---------- privacy ----------
$('clr-go').onclick = async () => {
  const what = { history: $('clr-history').checked, cookies: $('clr-cookies').checked, cache: $('clr-cache').checked,
    downloads: $('clr-downloads').checked, closedTabs: $('clr-closed').checked };
  if (!Object.values(what).some(Boolean)) return;
  $('clr-go').disabled = true;
  await call('clearData', what);
  $('clr-go').disabled = false;
  $('clr-done').textContent = 'Cleared.';
  setTimeout(() => { $('clr-done').textContent = ''; }, 3000);
};

// ---------- about / updates ----------
function renderAbout(a) {
  const release = a.mode === 'release';
  $('ab-versions').textContent = `Version ${a.appVersion || '?'} · Electron ${a.electron || a.current} · Chromium ${a.chromium}`;
  const text = release
    ? { 'up-to-date': 'Rove is up to date', 'update-available': 'A new version is available', unknown: 'Not checked yet' }[a.status]
    : { 'up-to-date': 'Your browser engine is up to date', 'update-available': 'An engine update is available',
      unsupported: 'Your browser engine no longer gets security fixes', unknown: 'Not checked yet' }[a.status];
  $('ab-update').textContent = release ? 'Download' : 'Update now';
  $('ab-status').textContent = text;
  $('ab-status').style.color = a.status === 'unsupported' ? 'var(--danger)' : '';
  $('ab-detail').textContent = [a.latest && (release ? `Newest: ${a.latest}` : `Newest: Electron ${a.latest}`), a.checkedAt && `Checked ${new Date(a.checkedAt).toLocaleString()}`,
    a.error && `Last check failed: ${a.error}`].filter(Boolean).join(' · ');
  $('ab-update').hidden = !(a.status === 'update-available' || a.status === 'unsupported');
}
$('ab-check').onclick = async () => { $('ab-check').disabled = true; renderAbout(await call('checkUpdates')); $('ab-check').disabled = false; };
$('ab-update').onclick = () => call('runUpdate');

// ---------- nav highlight ----------
const sections = [...document.querySelectorAll('section')];
function highlight() {
  const y = window.scrollY + 80;
  let current = sections[0].id;
  for (const s of sections) if (s.offsetTop <= y) current = s.id;
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('on', a.getAttribute('href') === '#' + current);
}
window.addEventListener('scroll', highlight, { passive: true });

// ---------- phone remote ----------
const when = (t) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
function renderRemote(r) {
  $('rm-empty').hidden = r.devices.length > 0;
  $('rm-list').replaceChildren(...r.devices.map((d) => {
    const row = document.createElement('div'); row.className = 'row item';
    const site = document.createElement('div'); site.className = 'site';
    site.append(Object.assign(document.createElement('div'), { className: 'label', textContent: d.name }),
      Object.assign(document.createElement('div'), { className: 'hint', textContent: d.connected ? 'Connected now' : `Last used ${when(d.lastSeen)}` }));
    const del = Object.assign(document.createElement('button'), { className: 'btn', textContent: 'Remove' });
    del.onclick = async () => renderRemote(await call('remoteForgetDevice', d.id));
    row.append(site, del);
    return row;
  }));
}
const loadRemote = async () => renderRemote(await call('remote'));
$('rm-new').addEventListener('click', async () => {
  if (!confirm('Forget every phone and make a new QR code? Phones will have to scan it again.')) return;
  renderRemote(await call('remoteNewLink'));
  flash($('rm-new'), 'Done');
});

// ---------- load ----------
async function load() {
  const data = await call('get');
  $('searchEngine').replaceChildren(...data.engines.map((e) => Object.assign(document.createElement('option'), { value: e.id, textContent: e.name })),
    Object.assign(document.createElement('option'), { value: 'custom', textContent: 'Custom…' }));
  render(data.settings);
  $('dl-folder').textContent = data.downloadsFolder;
  renderAbout(data.about);
  highlight();
}
window.pb.on((name, data) => {
  if (name === 'settings') { const was = S.remoteEnabled; render(data); if (was !== data.remoteEnabled) loadRemote(); }
  if (name === 'passwords-changed') { loadPasswords(); loadProfiles(); }
  if (name === 'remote-changed') loadRemote();
  if (name === 'update') renderAbout(data);
});
load().then(() => { loadPasswords(); loadProfiles(); loadRemote(); if (location.hash) document.querySelector(location.hash)?.scrollIntoView(); });
