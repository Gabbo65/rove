// Hex Injector: the user's own scripts (JavaScript, CSS, HTML), stored locally in browser.db.
// Rove never fills this with its own scripts; the one example is marked as such and can be deleted.
const { EventEmitter } = require('events');
const { get } = require('../db');

const LANGS = { js: 'JavaScript', css: 'CSS', html: 'HTML' };
const RUN_MODES = { manual: 'Manual', auto: 'Automatic' }; // manual = from the wheel / editor; auto = on its sites by itself
const MAX_CODE = 200_000;
const events = new EventEmitter();

const row = (r) => r && ({ id: r.id, name: r.name, description: r.description, lang: r.lang, code: r.code,
  sites: r.sites ? r.sites.split('\n') : [], run: r.run_mode === 'auto' ? 'auto' : 'manual', favorite: !!r.favorite, example: !!r.example, created: r.created, modified: r.modified });

function clean(s) {
  const name = String(s.name ?? '').trim().slice(0, 80);
  if (!name) throw new Error('Give the script a name');
  if (!LANGS[s.lang]) throw new Error('Pick JavaScript, CSS or HTML');
  const code = String(s.code ?? '');
  if (code.length > MAX_CODE) throw new Error('Script too long (200,000 characters at most)');
  // optional site limits: one host per line, e.g. "example.com" or "*.example.com"
  const sites = (Array.isArray(s.sites) ? s.sites : String(s.sites ?? '').split('\n')).map((x) => String(x).trim().toLowerCase())
    .filter(Boolean).slice(0, 50);
  for (const x of sites) if (!/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(x)) throw new Error(`Not a site: ${x}`);
  const run = s.run === 'auto' ? 'auto' : 'manual';
  if (run === 'auto' && !sites.length) throw new Error('Automatic scripts need at least one site');
  return { name, run, description: String(s.description ?? '').trim().slice(0, 300), lang: s.lang, code, sites: sites.join('\n'), favorite: s.favorite ? 1 : 0 };
}

function list() { return get().prepare('SELECT * FROM hex_scripts ORDER BY favorite DESC, lower(name)').all().map(row); }
function byId(id) { return row(get().prepare('SELECT * FROM hex_scripts WHERE id = ?').get(Number(id))); }

function save(s) {
  const c = clean(s);
  const now = Date.now();
  let id = Number(s.id) || 0;
  if (id && byId(id)) {
    get().prepare('UPDATE hex_scripts SET name=?, description=?, lang=?, code=?, sites=?, run_mode=?, favorite=?, example=0, modified=? WHERE id=?')
      .run(c.name, c.description, c.lang, c.code, c.sites, c.run, c.favorite, now, id);
  } else {
    id = Number(get().prepare('INSERT INTO hex_scripts (name, description, lang, code, sites, run_mode, favorite, example, created, modified) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(c.name, c.description, c.lang, c.code, c.sites, c.run, c.favorite, s.example ? 1 : 0, now, now).lastInsertRowid);
  }
  events.emit('change');
  return byId(id);
}

// Automatic scripts whose sites include this page.
function autoFor(url) {
  return get().prepare("SELECT * FROM hex_scripts WHERE run_mode = 'auto' ORDER BY id").all().map(row).filter((s) => allowedOn(s, url));
}

function remove(id) { get().prepare('DELETE FROM hex_scripts WHERE id = ?').run(Number(id)); events.emit('change'); }

function duplicate(id) {
  const s = byId(id);
  if (!s) throw new Error('No such script');
  return save({ ...s, id: 0, name: `${s.name} copy`.slice(0, 80), example: false });
}

function setFavorite(id, on) {
  get().prepare('UPDATE hex_scripts SET favorite = ? WHERE id = ?').run(on ? 1 : 0, Number(id));
  events.emit('change');
  return byId(id);
}

// Does a script's site list allow this page? (No list = any web page.)
function allowedOn(s, url) {
  if (!s.sites.length) return true;
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return s.sites.some((p) => (p.startsWith('*.') ? host === p.slice(2) || host.endsWith(p.slice(1)) : host === p || host === `www.${p}`));
}

// First use only: one clearly marked, deletable example.
function seedExample(settings) {
  if (settings.get('hexSeeded')) return;
  settings.set({ hexSeeded: true });
  if (list().length) return;
  save({ name: 'Example: outline links', lang: 'css', example: true,
    description: 'An example CSS script — run it again to turn it off. Delete it whenever you like.',
    code: 'a { outline: 2px dashed #e879f9 !important; outline-offset: 2px; }' });
}

module.exports = { LANGS, RUN_MODES, list, autoFor, byId, save, remove, duplicate, setFavorite, allowedOn, seedExample, on: (...a) => events.on(...a) };
