// Settings page: controls write validated settings, effects apply (theme, favorites bar, engine, start page, downloads).
const { nativeTheme } = require('electron');
const urls = require('../../src/main/urls');
const downloads = require('../../src/main/downloads');

module.exports = [
  {
    name: 'opens from the … menu path and ⌘, ; shows current values',
    async run(t) {
      const w = await t.fresh();
      t.hub.openInternal('settings', w);
      await t.until(() => w.active.url === 'pb://settings/' && !w.active.loading, { message: 'settings tab' });
      await t.loaded(w.active);
      await t.until(async () => (await t.page(`document.getElementById('searchEngine').options.length`)) === 6, { message: 'engines listed' });
      t.assert.equal(await t.page(`document.getElementById('searchEngine').value`), t.settings.get('searchEngine'));
      t.assert.equal(w.active.state().title, 'Settings');
      t.hub.openInternal('settings', w);
      t.assert.equal(w.tabs.filter((x) => x.url === 'pb://settings/').length, 1, 'reuses the open settings tab');
    },
  },
  {
    name: 'toggles and choices apply immediately (theme, favorites bar, search engine, sleeping)',
    async run(t) {
      const w = await t.fresh();
      await t.go('pb://settings/');
      await t.until(async () => (await t.page(`document.getElementById('searchEngine').options.length`)) === 6, { message: 'loaded' });
      await t.page(`document.querySelector('#theme [data-v=dark]').click()`);
      await t.until(() => t.settings.get('theme') === 'dark' && nativeTheme.themeSource === 'dark', { message: 'theme dark' });
      await t.page(`document.querySelector('[data-setting=showFavoritesBar]').click()`);
      await t.until(async () => t.ui(`document.body.classList.contains('no-favbar')`), { message: 'favbar hidden' });
      await t.page(`{ const s = document.getElementById('searchEngine'); s.value = 'duckduckgo'; s.dispatchEvent(new Event('change')); }`);
      await t.until(() => t.settings.get('searchEngine') === 'duckduckgo', { message: 'engine' });
      t.assert.match(urls.fromInput('hello world'), /^https:\/\/duckduckgo\.com\/\?q=hello%20world/);
      await t.page(`{ const s = document.getElementById('sleepAfterMinutes'); s.value = '5'; s.dispatchEvent(new Event('change')); }`);
      await t.until(() => t.settings.get('sleepAfterMinutes') === 5, { message: 'sleep minutes' });
      t.settings.set({ theme: 'system', showFavoritesBar: true, searchEngine: 'google', sleepAfterMinutes: 30 });
      await t.until(() => nativeTheme.themeSource === 'system', { message: 'theme back' });
    },
  },
  {
    name: 'custom search engine needs https + %s; start page opens in new windows; bad values are rejected',
    async run(t) {
      await t.fresh();
      await t.go('pb://settings/');
      await t.until(async () => (await t.page(`document.getElementById('searchEngine').options.length`)) === 6, { message: 'loaded' });
      await t.page(`{ const s = document.getElementById('searchEngine'); s.value = 'custom'; s.dispatchEvent(new Event('change')); }`);
      await t.until(async () => !(await t.page(`document.getElementById('custom-box').hidden`)), { message: 'custom box' });
      await t.page(`document.getElementById('custom-url').value = 'javascript:alert(1)'; document.getElementById('custom-save').click()`);
      await t.until(async () => /must start/.test(await t.page(`document.getElementById('custom-hint').textContent`)), { message: 'rejected' });
      await t.page(`document.getElementById('custom-name').value = 'Local'; document.getElementById('custom-url').value = ${JSON.stringify(t.url('/p1?q=%s'))}; document.getElementById('custom-save').click()`);
      await t.until(() => t.settings.get('customSearch').name === 'Local', { message: 'custom saved' });
      t.assert.equal(urls.fromInput('two words'), t.url('/p1?q=two%20words'));
      t.assert.deepEqual(t.settings.set({ startUrl: 'javascript:alert(1)' }), {}, 'non-web start page refused');
      t.settings.set({ startPage: 'url', startUrl: t.url('/p2') });
      const w2 = t.hub.create();
      await t.until(() => w2.active?.title === 'Page Two', { message: 'start page in new window' });
      t.settings.set({ startPage: 'newtab', startUrl: '', searchEngine: 'google' });
    },
  },
  {
    name: 'download folder setting is used; clear browsing data clears history and cookies',
    async run(t) {
      const fs = require('fs'), path = require('path');
      const dir = path.join(t.tmp, 'Other');
      fs.mkdirSync(dir, { recursive: true });
      t.settings.set({ downloadDir: dir });
      t.assert.equal(downloads.folder(), dir);
      const w = await t.fresh();
      await t.go(t.url('/cookie'));
      w.active.wc.downloadURL(t.url('/file.bin'));
      await t.until(() => fs.existsSync(path.join(dir, 'file.bin')), { message: 'saved to chosen folder' });
      t.settings.set({ downloadDir: '' });
      const ses = require('electron').session.defaultSession;
      t.assert.ok((await ses.cookies.get({ name: 'pbtest' })).length === 1);
      t.assert.ok(require('../../src/main/history').recent(5).length > 0);
      await require('../../src/main/settings-page').clearBrowsingData({ history: true, cookies: true, cache: true });
      t.assert.equal((await ses.cookies.get({ name: 'pbtest' })).length, 0);
      t.assert.equal(require('../../src/main/history').recent(5).length, 0);
    },
  },
];
