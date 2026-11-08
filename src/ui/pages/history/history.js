// History page: visits grouped by day, search, delete one / many / all. Data is queried page by page.
const PAGE = 200;
const $ = (id) => document.getElementById(id);
let items = [], more = false, query = '', reqId = 0;
const selected = new Set(); // visit ids

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
function dayLabel(t) {
  const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function highlight(el, text, q) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) { el.textContent = text; return; }
  const m = document.createElement('mark'); m.textContent = text.slice(i, i + q.length);
  el.replaceChildren(text.slice(0, i), m, text.slice(i + q.length));
}

async function load(reset = true) {
  const id = ++reqId;
  const res = await window.pb.call('query', { q: query, offset: reset ? 0 : items.length, limit: PAGE });
  if (id !== reqId) return; // a newer search started meanwhile
  items = reset ? res.items : items.concat(res.items);
  more = res.more;
  render();
}

function render() {
  const frag = document.createDocumentFragment();
  let section = null, lastDay = null;
  for (const h of items) {
    const label = dayLabel(h.t);
    if (label !== lastDay) {
      section = document.createElement('section');
      section.append(Object.assign(document.createElement('h2'), { textContent: label }));
      frag.append(section); lastDay = label;
    }
    const row = document.createElement('div'); row.className = 'row';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = selected.has(h.id);
    cb.onchange = () => { cb.checked ? selected.add(h.id) : selected.delete(h.id); updateBulk(); };
    const time = Object.assign(document.createElement('span'), { className: 'time',
      textContent: new Date(h.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) });
    const fav = document.createElement('span'); fav.className = 'fav';
    if (h.favicon) {
      const img = document.createElement('img'); img.src = h.favicon; img.alt = ''; fav.classList.add('img');
      img.onerror = () => { fav.classList.remove('img'); fav.textContent = host(h.url)[0] || '•'; };
      fav.append(img);
    } else fav.textContent = host(h.url)[0] || '•';
    const a = document.createElement('a'); a.href = h.url; a.title = h.url;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      window.pb.call('open', { url: h.url, newTab: e.metaKey || e.button === 1 });
    });
    const t = document.createElement('span'); t.className = 't'; highlight(t, h.title || h.url, query);
    const d = document.createElement('span'); d.className = 'd'; highlight(d, host(h.url), query);
    a.append(t, d);
    const del = document.createElement('button'); del.className = 'del'; del.title = 'Delete';
    del.innerHTML = '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
    del.onclick = () => window.pb.call('delete', [h.id]);
    row.append(cb, time, fav, a, del);
    section.append(row);
  }
  $('list').replaceChildren(frag);
  $('empty').hidden = items.length > 0;
  $('empty').textContent = query ? 'No matches' : 'No history yet';
  $('more').hidden = !more;
}

function updateBulk() {
  $('bulk').classList.toggle('on', selected.size > 0);
  document.body.classList.toggle('selecting', selected.size > 0);
  $('bulk-count').textContent = `${selected.size} selected`;
}

let searchTimer;
$('q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { query = $('q').value.trim(); load(true); }, 120);
});
$('more').onclick = () => load(false);
$('clear').onclick = () => { if (confirm('Clear all browsing history?')) window.pb.call('clear'); };
$('bulk-cancel').onclick = () => { selected.clear(); updateBulk(); render(); };
$('bulk-delete').onclick = () => {
  const ids = [...selected];
  selected.clear(); updateBulk();
  window.pb.call('delete', ids);
};

// History changed (new visit, deletion) → refresh what's shown.
window.pb.on((name) => { if (name === 'history-changed') load(true); });
load(true);
