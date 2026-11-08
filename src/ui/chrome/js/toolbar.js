// Toolbar: back/forward/reload, address bar, remote button.
import { $, pb, ICON } from './util.js';

const url = $('url'), back = $('back'), forward = $('forward'), reload = $('reload');
let active = null;   // active tab state
let editing = false; // user is typing in the address bar

export function showTab(tab) {
  active = tab;
  if (!tab) return;
  if (!editing && document.activeElement !== url) url.value = tab.url || '';
  back.disabled = !tab.canBack;
  forward.disabled = !tab.canForward;
  reload.classList.toggle('loading', !!tab.loading);
  reload.title = tab.loading ? 'Stop' : 'Reload (⌘R)';
  $('loading').classList.toggle('on', !!tab.loading);
  $('lock').innerHTML = (tab.url || '').startsWith('https://') ? ICON.lock : '';
  $('star').disabled = !!tab.internal || !/^https?:|^file:/.test(tab.url || '');
}

export function focusAddressBar() {
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
  $('remote-label').textContent = clients === 0 ? 'No remote' : clients === 1 ? 'iPhone connected' : `${clients} remotes`;
});
pb.on('qr-visible', (v) => remoteBtn.classList.toggle('qr-open', !!v));
