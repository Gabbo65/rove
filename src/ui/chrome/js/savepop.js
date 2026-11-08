// "Save password?" / "Save this address?" popup after you submit a form. The password itself never reaches this UI.
import { $, pb } from './util.js';
import * as popups from './popups.js';

const pop = $('save-pop'), keyBtn = $('key-btn');
let prompt = null;
keyBtn.dataset.popupAnchor = '';

function place() {
  const r = keyBtn.hidden ? $('star').getBoundingClientRect() : keyBtn.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(r.right - w + 10, innerWidth - w - 8))}px`;
}

function open() {
  if (!prompt) return;
  const pw = prompt.type === 'password';
  $('sp-title').textContent = pw ? (prompt.updating ? 'Update saved password?' : 'Save password?') : 'Save this address?';
  $('sp-sub').textContent = pw ? prompt.origin.replace(/^https?:\/\//, '') : prompt.summary;
  $('sp-fields').hidden = !pw;
  $('sp-never').hidden = !pw;
  $('sp-save').textContent = pw && prompt.updating ? 'Update' : 'Save';
  if (pw) $('sp-user').value = prompt.username;
  popups.register('save', () => { pop.hidden = true; });
  pop.hidden = false;
  place();
  (pw ? $('sp-user') : $('sp-save')).focus();
}

function answer(action) {
  pb.send('save-prompt:answer', { action, username: $('sp-user').value });
  pop.hidden = true;
  popups.unregister('save');
  pb.send('ui:focus-page');
}

pb.on('save-prompt', (p) => {
  prompt = p;
  keyBtn.hidden = !p || p.type !== 'password';
  if (p) open(); else { pop.hidden = true; popups.unregister('save'); }
});
keyBtn.onclick = () => (pop.hidden ? open() : popups.closeAll());
$('sp-save').onclick = () => answer('save');
$('sp-never').onclick = () => answer('never');
$('sp-later').onclick = () => { pop.hidden = true; popups.unregister('save'); pb.send('ui:focus-page'); }; // key icon stays to reopen
$('sp-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); answer('save'); } });
