// HUD over the page: find bar (⌘F) and the phone QR card. Tells the main process how big it is.
const $ = (id) => document.getElementById(id);
const root = $('root'), findbar = $('findbar'), input = $('find-input'), count = $('find-count'), qr = $('qr');

const toast = $('toast');
function reportSize() {
  const visible = !findbar.hidden || !qr.hidden || !toast.hidden;
  root.classList.toggle('empty', !visible);
  const r = root.getBoundingClientRect();
  window.pb.send('hud:size', visible ? { width: Math.ceil(r.width), height: Math.ceil(r.height) } : { width: 0, height: 0 });
}
new ResizeObserver(reportSize).observe(root);

const find = (forward = true, followUp = false) => window.pb.send('find', { text: input.value, forward, followUp });

window.pb.on('hud:state', (s) => {
  document.documentElement.classList.toggle('private', !!s.private);
  // QR
  qr.hidden = !s.qr.visible || (!s.qr.img && !s.qr.disabled);
  qr.classList.toggle('off', !!s.qr.disabled);
  if (s.qr.img) $('qr-img').src = s.qr.img;
  $('qr-addr').textContent = (s.qr.addr || '').replace(/^https?:\/\//, '').replace(/\/?\?.*$/, '');
  $('qr-title').textContent = s.qr.disabled ? 'Phone remote is off' : s.qr.offline ? 'Connect this computer to Wi-Fi'
    : s.qr.clients > 0 ? 'Connected — scan to add another' : 'Waiting for a device…';
  $('qr-sub').textContent = s.qr.disabled ? 'Turn it on in Settings → Phone remote' : s.qr.offline ? 'The QR code updates by itself once it’s online' : 'Scan with your phone (same Wi-Fi)';
  $('qr-img').style.opacity = s.qr.offline ? '0.15' : '';
  // Notice
  toast.hidden = !s.toast;
  $('toast-text').textContent = s.toast || '';
  // Find bar
  const wasOpen = !findbar.hidden;
  findbar.hidden = !s.find.open;
  if (s.find.open && (s.focusFind || !wasOpen)) {
    input.focus();
    input.select();
    if (input.value) find();
  }
  if ('findResult' in s) {
    const r = s.findResult;
    count.textContent = r ? (r.matches ? `${r.active}/${r.matches}` : '0/0') : '';
    findbar.classList.toggle('none', !!r && !r.matches);
  }
  if (s.findStep) find(s.findStep > 0, true);
  reportSize();
});

input.addEventListener('input', () => find());
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); find(!e.shiftKey, true); }
  if (e.key === 'Escape') { e.preventDefault(); window.pb.send('find:close'); }
});
$('find-prev').onclick = () => find(false, true);
$('find-next').onclick = () => find(true, true);
$('find-close').onclick = () => window.pb.send('find:close');
$('toast-close').onclick = () => window.pb.send('hud:toast-close');
reportSize();
