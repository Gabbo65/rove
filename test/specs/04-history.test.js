// History in SQLite: visits, popup, History page (search/paging/delete/clear), speed with lots of data.
const history = require('../../src/main/history');

module.exports = [
  {
    name: 'visits are recorded once (reloads within a minute are not new visits), with titles and icons',
    async run(t) {
      history.clear();
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      await t.go(t.url('/fav'));
      w.active.reload(); await t.sleep(400); await t.loaded(w.active);
      await t.until(() => history.recent(10).length === 2, { message: 'two pages' });
      const [latest, first] = history.recent(10);
      t.assert.equal(latest.title, 'With Icon');
      t.assert.equal(first.title, 'Page One');
      await t.until(() => history.recent(1)[0].favicon === t.url('/icon.png'), { message: 'favicon stored' });
      t.assert.equal(history.query({}).items.length, 2);
    },
  },
  {
    name: 'history popup lists recent pages; Show more opens the History page',
    async run(t) {
      history.clear();
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      await t.go(t.url('/p2'));
      await t.until(() => history.recent(5).length === 2, { message: 'recorded' });
      await t.ui(`document.getElementById('hist-btn').click()`);
      await t.until(async () => (await t.ui(`document.querySelectorAll('#hp-list .row-btn').length`)) === 2, { message: 'popup rows' });
      t.assert.ok(w.overlay);
      await t.ui(`document.getElementById('hp-more').click()`);
      await t.until(() => w.active.url === 'pb://history/', { message: 'history page opened' });
      t.assert.ok(!(await t.ui(`!document.getElementById('hist-panel').hidden`)));
    },
  },
  {
    name: 'History page: list, search, delete one, clear all',
    async run(t) {
      history.clear();
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      await t.go(t.url('/p2'));
      await t.go(t.url('/long'));
      await t.go('pb://history/');
      const rows = () => t.page(`document.querySelectorAll('.row').length`);
      await t.until(async () => (await rows()) === 3, { message: '3 rows' });
      await t.page(`{ const q = document.getElementById('q'); q.value = 'two'; q.dispatchEvent(new Event('input')); }`);
      await t.until(async () => (await rows()) === 1, { message: 'search filters' });
      await t.page(`document.querySelector('.del').click()`);
      await t.until(() => history.query({}).items.length === 2, { message: 'deleted one' });
      await t.page(`{ const q = document.getElementById('q'); q.value = ''; q.dispatchEvent(new Event('input')); }`);
      await t.until(async () => (await rows()) === 2, { message: 'list refreshed' });
      history.clear();
      await t.until(async () => (await rows()) === 0, { message: 'cleared → page updates' });
      t.assert.equal(w.active.state().title, 'History');
      t.assert.equal(w.active.state().url, '', 'no address shown for built-in pages');
    },
  },
  {
    name: 'fast with 50,000 visits (indexed queries, paging)',
    async run(t) {
      history.clear();
      const now = Date.now();
      const entries = Array.from({ length: 50000 }, (_, i) => ({ url: `https://site${i % 5000}.example/page${i}`, title: `Title ${i}`, t: now - i * 60000 }));
      history.importEntries(entries);
      let t0 = performance.now();
      const page1 = history.query({ limit: 200 });
      const page2 = history.query({ offset: 200, limit: 200 });
      const dtQuery = performance.now() - t0;
      t.assert.equal(page1.items.length, 200);
      t.assert.ok(page1.more && page2.items[0].t < page1.items[199].t);
      t0 = performance.now();
      const found = history.query({ q: 'Title 4999', limit: 50 });
      const dtSearch = performance.now() - t0;
      t.assert.ok(found.items.some((x) => x.title === 'Title 4999'));
      t0 = performance.now();
      history.recent(15);
      const dtRecent = performance.now() - t0;
      t.assert.ok(dtQuery < 100, `paging took ${dtQuery.toFixed(1)} ms`);
      t.assert.ok(dtSearch < 300, `search took ${dtSearch.toFixed(1)} ms`);
      t.assert.ok(dtRecent < 50, `recent took ${dtRecent.toFixed(1)} ms`);
      history.clear();
    },
  },
];
