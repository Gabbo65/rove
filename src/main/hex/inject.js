// Runs a Hex Injector script in a tab. Only on web pages (http, https, file) — never on Rove's own pages
// (they have the browser bridge) or other special pages. JavaScript runs in the page's own context with the
// page's powers only; nothing of Rove is exposed to it. CSS and HTML are toggles: run again to take them off.
const vm = require('vm');

const active = new WeakMap(); // webContents -> Map(scriptId -> { css key } | true for html)
function state(wc) {
  let m = active.get(wc);
  if (!m) {
    m = new Map();
    active.set(wc, m);
    wc.on('did-navigate', () => m.clear()); // a new page has none of our CSS / HTML
  }
  return m;
}

const isWebPage = (url) => /^(https?|file):/i.test(url || '');

async function run(script, tab, { allowedOn, auto = false }) {
  const wc = tab?.wc;
  if (!wc || wc.isDestroyed()) throw new Error('No page to run on');
  const url = wc.getURL();
  if (!isWebPage(url)) throw new Error('Scripts only run on web pages');
  if (!allowedOn(script, url)) throw new Error(`Only for: ${script.sites.join(', ')}`);
  const on = state(wc);

  if (auto && on.has(script.id)) return { message: 'Already on' }; // automatic runs only switch things on

  if (script.lang === 'css') {
    if (on.has(script.id)) {
      await wc.removeInsertedCSS(on.get(script.id)).catch(() => {});
      on.delete(script.id);
      return { message: 'CSS removed' };
    }
    on.set(script.id, await wc.insertCSS(script.code, { cssOrigin: 'author' }));
    return { message: 'CSS on — run it again to remove it' };
  }

  if (script.lang === 'html') {
    // Inserted at the end of the page in its own box (never replaces the page). <script> tags inside don't run.
    const id = JSON.stringify(String(script.id));
    const removed = await wc.executeJavaScript(`(() => {
      const old = document.querySelector('[data-hex-html=' + JSON.stringify(${id}) + ']');
      if (old) { old.remove(); return true; }
      const box = document.createElement('div');
      box.dataset.hexHtml = ${id};
      box.innerHTML = ${JSON.stringify(script.code)};
      (document.body || document.documentElement).append(box);
      return false;
    })()`, true);
    if (removed) on.delete(script.id); else on.set(script.id, true);
    return { message: removed ? 'HTML removed' : 'HTML added at the end of the page — run it again to remove it' };
  }

  // JavaScript: check it compiles first (nothing runs here), so a typo gives a real error message.
  try { new vm.Script(`(async () => {\n${script.code}\n})`, { filename: script.name }); } catch (e) {
    throw new Error(`${e.name}: ${e.message}`);
  }
  const r = await wc.executeJavaScript(`(async () => {
    try {
      const v = await (async () => {\n${script.code}\n})();
      if (v === undefined) return { ok: true };
      let s; try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch { s = String(v); }
      return { ok: true, value: String(s).slice(0, 500) };
    } catch (e) { return { ok: false, error: String(e && (e.name ? e.name + ': ' + e.message : e)).slice(0, 500) }; }
  })()`, true);
  if (!r || !r.ok) throw new Error(r?.error || 'The script failed');
  return { message: r.value === undefined ? 'Done' : `Done → ${r.value}`, value: r.value };
}

const isOn = (tab, id) => !!tab?.wc && !tab.wc.isDestroyed() && state(tab.wc).has(id);

module.exports = { run, isOn, isWebPage };
