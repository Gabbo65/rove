// Screenshots of the main screens (saved to PB_SNAPSHOTS or the temp folder) for a visual check.
const fs = require('fs');
const history = require('../../src/main/history');
const favorites = require('../../src/main/favorites');

module.exports = [
  {
    name: 'screens: settings, suggestions, save prompt, tab search, InPrivate',
    timeout: 60000,
    async run(t) {
      history.clear();
      t.db().exec('DELETE FROM favorites; DELETE FROM credentials;');
      favorites.add({ url: t.url('/p1'), title: 'Page One' });
      favorites.add({ url: t.url('/fav'), title: '' });
      const files = [];
      const w = await t.fresh();
      await t.go(t.url('/p1')); await t.go(t.url('/p2')); await t.go(t.url('/long'));
      await t.go('pb://settings/');
      await t.sleep(400);
      files.push(await t.snapshot('p2-settings'));
      await t.page(`document.getElementById('passwords').scrollIntoView(); 1`);
      await t.sleep(200);
      files.push(await t.snapshot('p2-settings-passwords'));
      await t.go(t.url('/form'));
      await t.ui(`{ const i = document.getElementById('url'); i.focus(); i.value = '127'; i.setSelectionRange(3, 3); i.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: '7' })); }`);
      await t.until(() => w.overlay, { message: 'suggestions open' });
      await t.sleep(400);
      files.push(await t.snapshot('p2-suggestions'));
      await t.ui(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.getElementById('url').blur()`);
      await t.page(`document.getElementById('user').value = 'ana@example.com'; document.getElementById('pass').value = 'x'; document.getElementById('login').requestSubmit(); 1`);
      await t.until(async () => !(await t.ui(`document.getElementById('save-pop').hidden`)), { message: 'save prompt' });
      await t.sleep(300);
      files.push(await t.snapshot('p2-save-password'));
      await t.ui(`document.getElementById('sp-later').click()`);
      w.newTab(t.url('/p3'));
      await t.sleep(300);
      await t.ui(`document.getElementById('tabsearch-btn').click()`);
      await t.until(() => w.overlay, { message: 'tab search' });
      await t.sleep(300);
      files.push(await t.snapshot('p2-tab-search'));
      await t.ui(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      const p = t.hub.create({ isPrivate: true });
      await t.until(() => p.uiReady && p.active?.wc && !p.active.wc.isLoading(), { message: 'private' });
      await t.sleep(500);
      files.push(await t.snapshot('p2-inprivate', p));
      p.base.close();
      for (const f of files) t.assert.ok(fs.statSync(f).size > 10_000, f);
    },
  },
];
