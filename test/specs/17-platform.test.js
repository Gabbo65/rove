// Windows / Linux / Mac differences: window buttons, shortcut labels, updates for downloaded releases.
const { app } = require('electron');
const updates = require('../../src/main/updates');
const passwords = require('../../src/main/passwords');

const MAC = process.platform === 'darwin';

module.exports = [
  {
    name: 'window frame: Mac traffic lights, or room for the system buttons on Windows / Linux',
    async run(t) {
      await t.fresh();
      t.assert.ok(await t.ui(`document.documentElement.classList.contains('os-${process.platform}')`), 'UI knows the system');
      const pad = await t.ui(`parseFloat(getComputedStyle(document.getElementById('tabstrip')).paddingRight)`);
      if (MAC) t.assert.ok(pad < 20, 'no room needed at the right on Mac');
      else t.assert.ok(pad >= 100, `room for minimize / maximize / close (${pad}px)`);
    },
  },
  {
    name: 'shortcut labels: ⌘ on Mac, Ctrl+ elsewhere (also on tabs added later and internal pages)',
    async run(t) {
      const w = await t.fresh();
      w.newTab(t.url('/p1'));
      await t.until(async () => (await t.ui(`document.querySelectorAll('.tab').length`)) === 2, { message: 'tabs' });
      const title = await t.ui(`document.querySelectorAll('.tab .close')[1].title`);
      const newtab = await t.ui(`document.getElementById('newtab').title`);
      if (MAC) { t.assert.match(title, /⌘W/); t.assert.match(newtab, /⌘T/); }
      else { t.assert.match(title, /Ctrl\+W/); t.assert.match(newtab, /Ctrl\+T/); t.assert.doesNotMatch(newtab, /⌘/); }
      await t.go('pb://settings/');
      const hint = await t.until(async () => t.page(`[...document.querySelectorAll('.hint')].map(h => h.textContent).find(x => /favorites|B$/.test(x) && /[⌘⇧]|Ctrl/.test(x)) || ''`, w.active), { message: 'settings hint' });
      if (MAC) t.assert.match(hint, /⇧⌘B/); else t.assert.match(hint, /Ctrl\+Shift\+B/);
    },
  },
  {
    name: 'downloaded release: checks GitHub Releases for a newer app version',
    async run(t) {
      await t.fresh();
      process.env.PB_UPDATE_MODE = 'release';
      try {
        process.env.PB_UPDATE_URL = t.url('/gh-latest?v=' + app.getVersion());
        let s = await updates.check();
        t.assert.equal(s.mode, 'release');
        t.assert.equal(s.status, 'up-to-date', `check error: ${s.error} (version ${app.getVersion()})`);
        process.env.PB_UPDATE_URL = t.url('/gh-latest?v=99.0.0');
        s = await updates.check();
        t.assert.equal(s.status, 'update-available');
        t.assert.equal(s.latest, '99.0.0');
        t.assert.equal(s.releaseUrl, 'https://github.com/Gabbo65/personal-browser/releases/tag/v99.0.0');
        await t.until(async () => (await t.ui(`document.getElementById('update-btn').title`)).includes('99.0.0'), { message: 'toolbar shows the new version' });
      } finally {
        delete process.env.PB_UPDATE_MODE;
        delete process.env.PB_UPDATE_URL;
        await updates.check().catch(() => {});
      }
    },
  },
  {
    name: 'passwords are only saved with a real system key store',
    async run(t) {
      const ok = await passwords.available();
      if (process.platform === 'linux') {
        const { safeStorage } = require('electron');
        const backend = safeStorage.getSelectedStorageBackend();
        t.assert.equal(ok, !['basic_text', 'unknown'].includes(backend), `backend ${backend}`);
      } else {
        t.assert.ok(ok, 'Keychain / Windows account key available');
      }
    },
  },
];
