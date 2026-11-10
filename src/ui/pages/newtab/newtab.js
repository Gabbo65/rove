// New Tab page: search box + favorites as tiles (live updates).
const tiles = document.getElementById('tiles');
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

let showFavs = true;
function show(favs) {
  document.getElementById('hint').hidden = favs.length > 0 || !showFavs;
  tiles.replaceChildren(...favs.map((f) => {
    const a = document.createElement('a');
    a.className = 'tile'; a.href = f.url; a.title = f.url;
    const icon = document.createElement('div');
    icon.className = 'icon';
    const letter = (f.title || host(f.url))[0] || '•';
    if (f.favicon) {
      const img = document.createElement('img');
      img.src = f.favicon; img.alt = '';
      img.onerror = () => { icon.textContent = letter; };
      icon.append(img);
    } else icon.textContent = letter;
    const name = document.createElement('div');
    name.className = 'name'; name.textContent = f.title; // empty name → icon only
    a.append(icon, name);
    return a;
  }));
}

document.getElementById('f').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  if (q) window.pb.call('search', q);
});

window.pb.on((name, data) => { if (name === 'favorites') show(data || []); });
window.pb.call('favorites').then(show);
window.pb.call('info').then((i) => {
  if (!i.private) return;
  document.documentElement.classList.add('private');
  document.getElementById('private-note').hidden = false;
  document.title = 'New InPrivate Tab';
});

// ---------- customization (Settings → New tab page) ----------
const $ = (id) => document.getElementById(id);
let clockTimer = null;
function applyLook(l) {
  const bg = $('bg');
  const image = l.ntBackground === 'image' && l.ntImage > 0;
  const gradient = l.ntBackground === 'gradient';
  bg.hidden = !(image || gradient);
  bg.className = gradient ? `g-${l.ntGradient}` : '';
  bg.style.backgroundImage = image ? `url("pb://shared/newtab-bg?v=${Number(l.ntImage)}")` : '';
  bg.style.setProperty('--dim', String((Number(l.ntDim) || 0) / 100));
  document.body.classList.toggle('has-bg', !bg.hidden);
  $('f').hidden = !l.ntShowSearch;
  document.body.classList.toggle('no-search', !l.ntShowSearch);
  $('tiles').hidden = !l.ntShowFavorites;
  if (!l.ntShowFavorites) $('hint').hidden = true;
  $('clockbox').hidden = l.ntClock === 'off';
  $('greet').hidden = l.ntClock !== 'greeting';
  clearInterval(clockTimer);
  if (l.ntClock !== 'off') { tick(); clockTimer = setInterval(tick, 1000); }
  showFavs = l.ntShowFavorites;
}
function tick() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const h = now.getHours();
  $('greet').textContent = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
window.pb.call('look').then(applyLook);
window.pb.on((name, data) => { if (name === 'look') applyLook(data); });
$('customize').onclick = () => window.pb.call('customize');
