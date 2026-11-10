// Custom CSS for Rove's UI + pages (never web pages, never the Settings page) and the setup file (export / import).
const fs = require('fs');
const path = require('path');
const os = require('os');
const setupFile = require('../../src/main/setup-file');

const CSS = '#toolbar { outline: 3px solid rgb(255, 0, 0) } body { letter-spacing: 3px }';

module.exports = [
  {
    name: 'custom CSS: styles the toolbar and Rove pages live, never web pages or the Settings page',
    async run(t) {
      t.settings.set({ customCss: '' });
      const w = await t.fresh();
      const nt = w.active;
      const st = w.newTab('pb://settings/#appearance'); await t.loaded(st);
      await t.until(async () => t.page(`!!document.getElementById('custom-css')`), { message: 'editor' });
      await t.page(`document.getElementById('custom-css').value = ${JSON.stringify(CSS)}; document.getElementById('custom-css-apply').click()`);
      await t.until(() => t.settings.get('customCss') === CSS, { message: 'saved' });
      await t.until(async () => (await t.ui(`getComputedStyle(document.getElementById('toolbar')).outlineColor`)) === 'rgb(255, 0, 0)', { message: 'toolbar restyled' });
      t.assert.equal(await t.page(`getComputedStyle(document.body).letterSpacing`), 'normal', 'Settings page stays untouched (so a bad CSS can be fixed)');
      // a New Tab page gets it; a web page doesn't
      w.activate(nt);
      await t.until(async () => (await t.page(`getComputedStyle(document.body).letterSpacing`, nt)) === '3px', { message: 'New Tab restyled' });
      const web = w.newTab(t.url('/p1')); await t.loaded(web);
      t.assert.equal(await t.page(`getComputedStyle(document.body).letterSpacing`, web), 'normal', 'web pages never');
      t.settings.set({ customCss: 'x'.repeat(50_001) });
      t.assert.equal(t.settings.get('customCss'), CSS, 'too long refused');
      t.settings.set({ customCss: '' });
      await t.until(async () => (await t.ui(`getComputedStyle(document.getElementById('toolbar')).outlineStyle`)) === 'none', { message: 'cleared' });
    },
  },
  {
    name: 'setup file: exports look/layout/glass/New Tab/CSS only; import applies valid values and refuses junk',
    async run(t) {
      t.settings.set({ lookTheme: 'forest', accentColor: '#c239b3', toolbarStyle: 'solid', pagesStyle: 'glass', glassLevel: 60,
        tabsPosition: 'left', ntClock: 'greeting', customCss: '.tab { color: red }' });
      const d = setupFile.data();
      t.assert.equal(d.app, 'rove');
      t.assert.equal(d.settings.lookTheme, 'forest');
      t.assert.equal(d.settings.customCss, '.tab { color: red }');
      for (const priv of ['searchEngine', 'downloadDir', 'remoteEnabled', 'startUrl', 'ntImage', 'offerSavePasswords']) t.assert.ok(!(priv in d.settings), `${priv} not exported`);
      // back to defaults, then import the file
      t.settings.set({ lookTheme: 'default', accentColor: '', pagesStyle: 'solid', glassLevel: 85, tabsPosition: 'top', ntClock: 'off', customCss: '' });
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rove-setup-'));
      const file = path.join(dir, 'setup.json');
      fs.writeFileSync(file, JSON.stringify({ ...d, settings: { ...d.settings, accentColor: 'javascript:alert(1)', downloadDir: '/evil', unknown: 1 } }));
      const r = setupFile.importFile(file);
      t.assert.ok(r.ok, JSON.stringify(r));
      t.assert.equal(t.settings.get('lookTheme'), 'forest');
      t.assert.equal(t.settings.get('tabsPosition'), 'left');
      t.assert.equal(t.settings.get('glassLevel'), 60);
      t.assert.equal(t.settings.get('accentColor'), '', 'bad value refused by the schema');
      t.assert.notEqual(t.settings.get('downloadDir'), '/evil', 'keys outside the setup are ignored');
      fs.writeFileSync(file, '{"app":"other"}');
      t.assert.match(setupFile.importFile(file).error, /isn’t a Rove setup/);
      fs.writeFileSync(file, 'not json');
      t.assert.match(setupFile.importFile(file).error, /valid JSON/);
      fs.rmSync(dir, { recursive: true, force: true });
      t.settings.set({ lookTheme: 'default', accentColor: '', pagesStyle: 'solid', glassLevel: 85, tabsPosition: 'top', ntClock: 'off', customCss: '' });
    },
  },
];
