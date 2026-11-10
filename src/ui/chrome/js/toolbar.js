// Toolbar: back/forward/reload, address bar, remote button.
import { $, pb, ICON } from './util.js';

const url = $('url'), back = $('back'), forward = $('forward'), reload = $('reload');
let active = null;   // active tab state
let editing = false; // user is typing in the address bar
let shownUrl = null; // the active tab's address at the last update

export function showTab(tab) {
  const switched = !!tab && active?.id !== tab.id;
  active = tab;
  if (!tab) return;
  // Another tab became active: always show its address (a new tab's is empty), even while the bar is
  // focused — the "focus the address bar" command for a new tab can arrive before its state does.
  if (switched) {
    editing = false;
    url.value = tab.url || '';
    if (document.activeElement === url) url.select();
  } else if (!editing && (document.activeElement !== url || tab.url !== shownUrl)) url.value = tab.url || '';
  shownUrl = tab.url;
  back.disabled = !tab.canBack;
  forward.disabled = !tab.canForward;
  reload.classList.toggle('loading', !!tab.loading);
  reload.title = tab.loading ? 'Stop' : 'Reload (⌘R)';
  $('loading').classList.toggle('on', !!tab.loading);
  $('lock').innerHTML = (tab.url || '').startsWith('https://') ? ICON.lock : '';
  $('star').disabled = !!tab.internal || !/^https?:|^file:/.test(tab.url || '');
}

export function focusAddressBar() {
  if (editing && document.activeElement === url) return; // already typing here: don't select (and lose) the text
  url.focus();
  url.select();
}

// The address bar's own submit handler can be replaced (suggestions module, Phase 2).
export const addressBar = {
  el: url,
  submit(input, disposition = 'current') {
    editing = false;
    pb.send('navigate', { input, disposition, typed: true });
    url.blur();
  },
  reset() {
    editing = false;
    url.value = active?.url || '';
  },
  setEditing(v) { editing = v; },
};

$('urlform').addEventListener('submit', (e) => {
  e.preventDefault();
  addressBar.submit(url.value);
});
url.addEventListener('focus', () => url.select());
url.addEventListener('input', () => { editing = true; });
url.addEventListener('blur', () => { if (!editing) addressBar.reset(); });
url.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !e.defaultPrevented) {
    addressBar.reset();
    url.blur();
    pb.send('ui:focus-page');
  }
});

back.onclick = () => pb.send('nav', 'back');
forward.onclick = () => pb.send('nav', 'forward');
reload.onclick = () => pb.send('nav', active?.loading ? 'stop' : 'reload');

// Phone remote button: label shows connection; click always toggles the QR (whatever the connection state).
const remoteBtn = $('remote-btn');
remoteBtn.onclick = () => pb.send('qr:toggle');
pb.on('remote-status', ({ clients }) => {
  remoteBtn.classList.toggle('on', clients > 0);
  $('remote-label').textContent = clients === 0 ? 'No remote' : clients === 1 ? 'Phone connected' : `${clients} remotes`;
});
pb.on('qr-visible', (v) => remoteBtn.classList.toggle('qr-open', !!v));
