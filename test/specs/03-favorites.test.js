// Favorites: star → popup, edit name/URL (empty name = icon only), reorder by drag, New Tab tiles, stored in SQLite.
const favorites = require('../../src/main/favorites');

const reset = (t) => t.db().exec('DELETE FROM favorites');
const uiFavTitles = (t) => t.ui(`[...document.querySelectorAll('.favitem')].map(b => b.querySelector('span')?.textContent ?? '(icon)').join('|')`);

module.exports = [
  {
    name: '☆ adds the page and opens the name popup first; Done saves (empty name allowed)',
    async run(t) {
      reset(t);
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      await t.ui(`document.getElementById('star').click()`);
      await t.until(() => favorites.list().length === 1, { message: 'favorite added' });
      await t.until(async () => !(await t.ui(`document.getElementById('fav-pop').hidden`)), { message: 'popup open' });
      t.assert.equal(await t.ui(`document.getElementById('fp-title').textContent`), 'Favorite added');
      t.assert.equal(await t.ui(`document.getElementById('fp-name').value`), 'Page One');
      t.assert.ok(w.overlay, 'UI lifted above the page while the popup is open');
      t.assert.equal(w.base.contentView.children.at(-1), w.chrome);
      // clear the name → saved as empty → icon only
      await t.ui(`document.getElementById('fp-name').value = ''; document.getElementById('fp-save').click()`);
      await t.until(() => favorites.list()[0].title === '', { message: 'empty name saved' });
      await t.until(async () => (await uiFavTitles(t)) === '(icon)', { message: 'icon-only in bar' });
      await t.until(() => !w.overlay, { message: 'popup closed → page back on top' });
      t.assert.ok(await t.ui(`document.getElementById('star').classList.contains('on')`));
    },
  },
  {
    name: 'edit: invalid URL rejected, valid one saved; remove from popup',
    async run(t) {
      reset(t);
      const f = favorites.add({ url: t.url('/p1'), title: 'One' });
      await t.fresh();
      await t.until(async () => (await uiFavTitles(t)) === 'One', { message: 'bar shows favorite' });
      await t.ui(`(async () => { const m = await import('./js/favbar.js'); m.edit(${f.id}); })()`);
      await t.ui(`document.getElementById('fp-url').value = 'hello world'; document.getElementById('fp-save').click()`);
      await t.until(async () => t.ui(`document.getElementById('fp-url').classList.contains('bad')`), { message: 'rejected' });
      t.assert.equal(favorites.list()[0].url, t.url('/p1'));
      await t.ui(`document.getElementById('fp-name').value = 'Renamed'; document.getElementById('fp-url').value = ${JSON.stringify(t.url('/p2'))}; document.getElementById('fp-save').click()`);
      await t.until(() => favorites.list()[0].title === 'Renamed' && favorites.list()[0].url === t.url('/p2'), { message: 'saved' });
      await t.ui(`(async () => { const m = await import('./js/favbar.js'); m.edit(${f.id}); document.getElementById('fp-remove').click(); })()`);
      await t.until(() => favorites.list().length === 0, { message: 'removed' });
    },
  },
  {
    name: 'drag a favorite: horizontal only, stays in the bar, order stored, no click opens',
    async run(t) {
      reset(t);
      for (const n of ['Alpha', 'Bravo', 'Charlie']) favorites.add({ url: t.url(`/p1?${n}`), title: n });
      const w = await t.fresh();
      await t.until(async () => (await uiFavTitles(t)) === 'Alpha|Bravo|Charlie', { message: 'bar' });
      const r = await t.ui(`(() => { const b = document.querySelectorAll('.favitem')[0].getBoundingClientRect(); return { x: b.left + 15, y: b.top + 12, top: b.top }; })()`);
      const seen = await t.mouseDrag({ x: r.x, y: r.y }, [
        { x: r.x + 30, y: r.y }, { x: r.x + 200, y: r.y + 400 }, { x: 1275, y: 5 },
      ], '.favitem');
      for (const s of seen.filter(Boolean)) {
        t.assert.ok(Math.abs(s.top - r.top) < 1, 'stays on the bar');
        t.assert.ok(s.right <= s.rowRight + 1 && s.left >= s.rowLeft - 1, 'stays inside the bar');
      }
      await t.until(() => favorites.list().map((f) => f.title).join('|') === 'Bravo|Charlie|Alpha', { message: 'stored order' });
      await t.sleep(300);
      t.assert.equal(w.active.url, 'pb://newtab/', 'dropping did not open the favorite');
    },
  },
  {
    name: 'a wide favorite grabbed by its icon can pass a narrow one at the end of the bar',
    async run(t) {
      reset(t);
      favorites.add({ url: t.url('/fav?a'), title: 'A rather long favorite name' });
      favorites.add({ url: t.url('/fav?b'), title: 'X' });
      await t.fresh();
      await t.until(async () => (await uiFavTitles(t)) === 'A rather long favorite name|X', { message: 'bar' });
      const r = await t.ui(`(() => { const b = document.querySelector('.favitem').firstElementChild.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
      const seen = await t.mouseDrag({ x: r.x, y: r.y }, [{ x: r.x + 20, y: r.y }, { x: r.x + 400, y: r.y + 100 }, { x: 1275, y: r.y }], '.favitem');
      t.assert.ok(seen.filter(Boolean).length >= 2, 'dragging by the icon drags the favorite');
      await t.until(() => favorites.list().map((f) => f.title).join('|') === 'X|A rather long favorite name', { message: 'wide one moved past the narrow one' });
    },
  },
  {
    name: 'New Tab page shows favorites as tiles and updates live',
    async run(t) {
      reset(t);
      favorites.add({ url: t.url('/p1'), title: 'Tile One' });
      const w = await t.fresh();
      const names = () => t.page(`[...document.querySelectorAll('.tile .name')].map(n => n.textContent || '(none)').join('|')`, w.active);
      await t.until(async () => (await names()) === 'Tile One', { message: 'tiles on start' });
      favorites.add({ url: t.url('/p2'), title: '' });
      await t.until(async () => (await names()) === 'Tile One|(none)', { message: 'live update' });
    },
  },
  {
    name: 'favicon of a visited favorite is filled in',
    async run(t) {
      reset(t);
      favorites.add({ url: t.url('/fav'), title: 'Icon' });
      await t.fresh();
      await t.go(t.url('/fav'));
      await t.until(() => favorites.list()[0].favicon === t.url('/icon.png'), { message: 'favicon stored' });
    },
  },
];
