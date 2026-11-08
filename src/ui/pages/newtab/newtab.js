// New Tab page: search box + favorites as tiles (live updates).
const tiles = document.getElementById('tiles');
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function show(favs) {
  document.getElementById('hint').hidden = favs.length > 0;
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
