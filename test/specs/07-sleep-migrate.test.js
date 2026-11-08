// Sleeping tabs (memory) and the one-time import of the old version's data.
const { BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');
const migrate = require('../../src/main/migrate');
const favorites = require('../../src/main/favorites');
const history = require('../../src/main/history');
const downloads = require('../../src/main/downloads');

module.exports = [
  {
    name: 'idle background tabs fall asleep (page process freed) and wake with their history',
    async run(t) {
      t.settings.set({ sleepingTabs: true, sleepAfterMinutes: 30 });
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      await t.go(t.url('/p2'));
      const a = w.active;
      const b = w.newTab(t.url('/p3')); await t.loaded(b);
      const pid = a.wc.getOSProcessId();
      const wcId = a.wc.id;
      a.lastActive = Date.now() - 31 * 60_000;           // not looked at for 31 minutes
      t.assert.equal(t.hub.sleepIdleTabs(), 1);
      t.assert.ok(a.asleep && !a.view, 'view released');
      await t.until(() => !require('electron').webContents.fromId(wcId), { message: 'page webContents destroyed' });
      t.assert.ok(b.view, 'visible tab never sleeps');
      await t.until(async () => (await t.ui(`document.querySelector('.tab.asleep') !== null`)), { message: 'UI shows sleeping tab' });
      t.assert.equal(a.state().title, 'Page Two');
      t.assert.ok(a.canGoBack(), 'back history kept while asleep');
      w.activate(a);
      await t.until(() => a.wc && a.title === 'Page Two' && !a.loading, { message: 'woke up' });
      t.assert.notEqual(a.wc.getOSProcessId(), pid);
      a.back();
      await t.until(() => a.title === 'Page One', { message: 'history works after waking' });
    },
  },
  {
    name: 'tabs playing sound and recently used tabs stay awake; setting off = never sleep',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      const b = w.newTab(t.url('/p2')); await t.loaded(b);
      const a = w.tabs[0];
      a.lastActive = Date.now() - 2 * 3600_000;
      a.audible = true;
      t.assert.equal(t.hub.sleepIdleTabs(), 0);
      a.audible = false;
      t.settings.set({ sleepingTabs: false });
      t.assert.equal(t.hub.sleepIdleTabs(), 0);
      t.settings.set({ sleepingTabs: true });
      t.assert.equal(t.hub.sleepIdleTabs(), 1);
    },
  },
  {
    name: 'old data (favorites, history, closed tabs, favbar, downloads) is imported once',
    async run(t) {
      // Seed the old storage exactly like the previous version kept it: localStorage of the file:// UI page.
      const seed = new BrowserWindow({ show: false });
      await seed.loadFile(path.join(__dirname, '..', '..', 'src', 'migrate', 'index.html'));
      const now = Date.now();
      await seed.webContents.executeJavaScript(`
        localStorage.setItem('favorites', ${JSON.stringify(JSON.stringify([{ url: 'https://old.example/', title: 'Old Fav', favicon: null }, { url: 'https://icon.example/', title: '' }]))});
        localStorage.setItem('history', ${JSON.stringify(JSON.stringify([{ url: 'https://old.example/b', title: 'B', t: now - 1000 }, { url: 'https://old.example/a', title: 'A', t: now - 5000 }]))});
        localStorage.setItem('closeHistory', ${JSON.stringify(JSON.stringify([{ tabs: [{ url: 'https://old.example/closed', index: 0 }], active: null }]))});
        localStorage.setItem('favbar', 'false'); 1`);
      seed.destroy();
      fs.writeFileSync(path.join(app.getPath('userData'), 'downloads.json'),
        JSON.stringify([{ name: 'x.pdf', path: '/tmp/x.pdf', url: 'https://old.example/x.pdf', total: 10, received: 10, state: 'completed', time: now }]));
      t.db().exec('DELETE FROM favorites; DELETE FROM closed_actions; DELETE FROM downloads;');
      history.clear();
      t.db().prepare('DELETE FROM kv WHERE key = ?').run(migrate.FLAG);

      const res = await migrate.run();
      t.assert.deepEqual({ f: res.favorites, h: res.history, c: res.closed, d: res.downloads }, { f: 2, h: 2, c: 1, d: 1 });
      t.assert.deepEqual(favorites.list().map((f) => f.title), ['Old Fav', '']);
      t.assert.deepEqual(history.recent(5).map((h) => h.title), ['B', 'A']);
      t.assert.equal(t.settings.get('showFavoritesBar'), false);
      t.assert.ok(downloads.list().some((d) => d.name === 'x.pdf'));
      t.assert.ok(fs.existsSync(path.join(app.getPath('userData'), 'downloads.json.imported')));
      const w = await t.fresh();
      t.db().exec('DELETE FROM closed_actions');
      require('../../src/main/closed').shared.push({ tabs: [{ url: t.url('/p3'), index: 0 }], activeUrl: null });
      t.assert.ok(w.reopenClosed());
      t.assert.deepEqual(await migrate.run(), { skipped: true }, 'never runs twice');
      t.settings.set({ showFavoritesBar: true });
    },
  },
];
