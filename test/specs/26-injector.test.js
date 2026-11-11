// Hex Injector: your own JS / CSS / HTML scripts — stored locally, run in the current web page, never on Rove's pages.
const scripts = require('../../src/main/hex/scripts');
const inject = require('../../src/main/hex/inject');

const reset = (t) => t.db().exec('DELETE FROM hex_scripts');
const runIn = (s, tab) => inject.run(s, tab, { allowedOn: scripts.allowedOn });

module.exports = [
  {
    name: 'scripts: save / validate / duplicate / favorite / delete; site limits; the example is marked and only added once',
    async run(t) {
      reset(t);
      t.settings.set({ hexSeeded: false });
      scripts.seedExample(t.settings);
      t.assert.equal(scripts.list().length, 1);
      t.assert.ok(scripts.list()[0].example, 'marked as example');
      scripts.remove(scripts.list()[0].id);
      scripts.seedExample(t.settings);
      t.assert.equal(scripts.list().length, 0, 'never re-added after you delete it');
      t.assert.throws(() => scripts.save({ name: '', lang: 'js' }), /name/);
      t.assert.throws(() => scripts.save({ name: 'x', lang: 'sql' }), /JavaScript, CSS or HTML/);
      t.assert.throws(() => scripts.save({ name: 'x', lang: 'js', sites: 'http://evil/path' }), /Not a site/);
      const s = scripts.save({ name: 'Title', lang: 'js', code: 'document.title = "hexed"', sites: 'example.com\n*.test.org' });
      t.assert.deepEqual(s.sites, ['example.com', '*.test.org']);
      t.assert.ok(scripts.allowedOn(s, 'https://www.example.com/a') && scripts.allowedOn(s, 'https://a.test.org/'));
      t.assert.ok(!scripts.allowedOn(s, 'https://evil.com/'));
      const d = scripts.duplicate(s.id);
      t.assert.equal(d.name, 'Title copy');
      t.assert.ok(scripts.setFavorite(d.id, true).favorite);
      t.assert.equal(scripts.list()[0].id, d.id, 'favorites first');
      scripts.remove(d.id);
      t.assert.equal(scripts.list().length, 1);
    },
  },
  {
    name: 'run: JavaScript in the page (value + real errors); CSS and HTML toggle on/off; never on Rove pages or other sites',
    async run(t) {
      reset(t);
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      const tab = w.active;
      const js = scripts.save({ name: 'JS', lang: 'js', code: 'document.title = "hexed"; return 6 * 7;' });
      t.assert.equal((await runIn(js, tab)).value, '42');
      t.assert.equal(await t.page('document.title'), 'hexed', 'ran in the page');
      await t.assert.rejects(runIn(scripts.save({ ...js, code: 'this is not js(' }), tab), /SyntaxError/);
      await t.assert.rejects(runIn(scripts.save({ ...js, code: 'throw new TypeError("boom")' }), tab), /TypeError: boom/);
      t.assert.equal(await t.page('typeof window.pb'), 'undefined', 'no Rove bridge in the page');
      // CSS: on, then off
      const css = scripts.save({ name: 'CSS', lang: 'css', code: 'body { outline: 4px solid rgb(1, 2, 3) }' });
      t.assert.match((await runIn(css, tab)).message, /CSS on/);
      t.assert.equal(await t.page('getComputedStyle(document.body).outlineColor'), 'rgb(1, 2, 3)');
      t.assert.match((await runIn(css, tab)).message, /removed/);
      t.assert.notEqual(await t.page('getComputedStyle(document.body).outlineColor'), 'rgb(1, 2, 3)');
      // HTML: added in its own box at the end (its <script> doesn't run), then removed
      const html = scripts.save({ name: 'HTML', lang: 'html', code: '<p id="hx">hi</p><script>document.title="pwned"</script>' });
      await runIn(html, tab);
      t.assert.equal(await t.page(`document.getElementById('hx')?.textContent`), 'hi');
      t.assert.notEqual(await t.page('document.title'), 'pwned');
      t.assert.ok(await t.page(`!!document.querySelector('h1')`), 'page itself untouched');
      await runIn(html, tab);
      t.assert.equal(await t.page(`!!document.getElementById('hx')`), false);
      // never on Rove's own pages; site limits respected
      await t.go('pb://settings/');
      await t.assert.rejects(runIn(js, w.active), /only run on web pages/);
      await t.go(t.url('/p1'));
      await t.assert.rejects(runIn(scripts.save({ ...js, sites: 'example.com' }), w.active), /Only for: example.com/);
    },
  },
  {
    name: 'wheel: Injector → JavaScript / CSS / HTML → your scripts; clicking one runs it on the tab',
    async run(t) {
      reset(t);
      scripts.save({ name: 'Make it hexed', lang: 'js', code: 'document.title = "from the wheel"' });
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      const ww = () => t.hub.hex.wheelWindow();
      const wjs = (code) => ww().webContents.executeJavaScript(code);
      t.hub.hex._testNoMouse(true); // before it shows: the real mouse must never reach the wheel
      t.hub.hex.close(); t.hub.hex.open(w);
      await t.until(async () => (await wjs(`!document.getElementById('hex').hidden`)), { message: 'open' });
      const labels = () => wjs(`[...document.querySelectorAll('#hex .hx-sector')].map((g) => g.getAttribute('aria-label')).join()`);
      const click = (l) => wjs(`document.querySelector('#hex .hx-sector[aria-label="${l}"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); 1`);
      await click('Injector');
      t.assert.equal(await labels(), 'JavaScript,CSS,HTML,Scripts…');
      await click('CSS');
      t.assert.match(await wjs(`document.querySelector('#hex .hx-caption').textContent`), /No manual scripts here yet/);
      await wjs(`document.querySelector('#hex .hx-hub').dispatchEvent(new MouseEvent('click', { bubbles: true })); 1`);
      await click('JavaScript');
      t.assert.equal(await labels(), 'Make it hexed');
      await click('Make it hexed');
      await t.until(async () => (await t.page('document.title')) === 'from the wheel', { message: 'ran on the tab' });
      await t.until(() => !ww().isVisible(), { message: 'wheel closed' });
      t.assert.match(w.toast || '', /Make it hexed: Done/);
    },
  },
  {
    name: 'Injector window: always on top; write a script and run it on the current tab; only that window may use its channels',
    async run(t) {
      reset(t);
      const w = await t.fresh();
      await t.go(t.url('/p2'));
      const ed = t.hub.hexInjector.openEditor();
      await t.until(() => ed.isVisible() && !ed.webContents.isLoading(), { message: 'editor open' });
      t.assert.ok(ed.isAlwaysOnTop(), 'always on top');
      const ejs = (code) => ed.webContents.executeJavaScript(code);
      await ejs(`document.getElementById('new').click(); 1`);
      await ejs(`(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')); };
        set('name', 'Shout'); set('lang', 'js'); set('code', 'document.title = document.title.toUpperCase(); return "ok"'); })()`);
      await ejs(`document.getElementById('run').click(); 1`);
      await t.until(async () => (await t.page('document.title')) === 'PAGE TWO', { message: 'ran on the current tab' });
      await t.until(async () => /Done → ok/.test(await ejs(`document.getElementById('status').textContent`)), { message: 'result shown' });
      t.assert.equal(scripts.list()[0].name, 'Shout', 'saved before running');
      // the wheel window has the same bridge but may not use the editor's channels
      await t.assert.rejects(t.hub.hex.wheelWindow().webContents.executeJavaScript(`window.pb.invoke('hexs:list')`), /not allowed/);
      ed.close();
    },
  },
  {
    name: 'manual vs automatic: automatic scripts need a site, run by themselves when it loads, and stay out of the wheel',
    async run(t) {
      reset(t);
      t.assert.throws(() => scripts.save({ name: 'A', lang: 'js', run: 'auto' }), /need at least one site/);
      const host = new URL(t.url('/p1')).hostname;
      const auto = scripts.save({ name: 'Auto title', lang: 'js', run: 'auto', sites: host, code: 'document.title = "auto ran"' });
      t.assert.equal(auto.run, 'auto');
      scripts.save({ name: 'Auto css', lang: 'css', run: 'auto', sites: host, code: 'body { outline: 3px solid rgb(4, 5, 6) }' });
      scripts.save({ name: 'Elsewhere', lang: 'js', run: 'auto', sites: 'example.com', code: 'document.title = "wrong site"' });
      t.assert.equal(scripts.save({ name: 'By hand', lang: 'js', code: '1' }).run, 'manual', 'manual by default');
      await t.fresh();
      await t.go(t.url('/p1'));
      await t.until(async () => (await t.page('document.title')) === 'auto ran', { message: 'auto JS ran on load' });
      await t.until(async () => (await t.page('getComputedStyle(document.body).outlineColor')) === 'rgb(4, 5, 6)', { message: 'auto CSS on' });
      await t.go(t.url('/p2'));
      await t.until(async () => (await t.page('document.title')) === 'auto ran', { message: 'again on the next page of the site' });
      // the wheel lists only manual scripts
      const js = t.hub.hex.list().find((f) => f.id === 'injector').items.find((g) => g.id === 'script.lang.js');
      t.assert.deepEqual(js.items.map((i) => i.name), ['By hand']);
      // the editor shows Manual / Automatic sections and can switch a script's mode
      const ed = t.hub.hexInjector.openEditor();
      await t.until(() => ed.isVisible() && !ed.webContents.isLoading(), { message: 'editor open' });
      const ejs = (code) => ed.webContents.executeJavaScript(code);
      await t.until(async () => (await ejs(`[...document.querySelectorAll('#list .sec')].map((e) => e.textContent).join()`)) === 'Manual,Automatic', { message: 'sections' });
      await ejs(`[...document.querySelectorAll('#list .row')].find((r) => r.textContent.includes('By hand')).click(); 1`);
      await ejs(`document.querySelector('#runmode [data-v=auto]').click(); document.getElementById('save').click(); 1`);
      await t.until(async () => /at least one site/.test(await ejs(`document.getElementById('status').textContent`)), { message: 'needs a site' });
      await ejs(`{ const e = document.getElementById('sites'); e.value = 'example.com'; e.dispatchEvent(new Event('input')); } document.getElementById('save').click(); 1`);
      await t.until(() => scripts.list().find((s) => s.name === 'By hand').run === 'auto', { message: 'switched to automatic' });
      ed.close();
      reset(t);
    },
  },
];
