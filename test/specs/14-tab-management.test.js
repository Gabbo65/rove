// Pinned tabs (front, icon-only, remembered for next launch), manual sleep, tab search.
const db = require('../../src/main/db');

module.exports = [
  {
    name: 'pin: moves to the front, icon-only, survives "close others", remembered and restored asleep',
    async run(t) {
      db.kv.set('pinnedTabs', []);
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      const b = w.newTab(t.url('/fav')); await t.loaded(b);
      const c = w.newTab(t.url('/p3')); await t.loaded(c);
      w.setPinned(b, true);
      t.assert.equal(w.tabs[0], b, 'pinned goes first');
      await t.until(async () => t.ui(`document.querySelectorAll('.tab')[0].classList.contains('pinned')`), { message: 'icon-only in UI' });
      w.closeMany(w.tabs.filter((x) => x !== c && !x.pinned));
      t.assert.ok(w.tabs.includes(b), 'close others keeps pinned');
      t.assert.deepEqual(db.kv.get('pinnedTabs').map((p) => p.title), ['With Icon']);
      // a moved/navigated pinned tab updates what is remembered
      b.load(t.url('/p2')); await t.until(() => b.title === 'Page Two', { message: 'pinned navigated' });
      await t.until(() => db.kv.get('pinnedTabs')[0]?.url === t.url('/p2'), { message: 'saved new address' });
      // next launch: restored at the front, asleep (no page loaded yet), start page active
      const w2 = t.hub.create({ pinned: db.kv.get('pinnedTabs') });
      await t.until(() => w2.uiReady, { message: 'window' });
      t.assert.ok(w2.tabs[0].pinned && w2.tabs[0].asleep && !w2.tabs[0].view, 'restored pinned tab is asleep');
      t.assert.equal(w2.active, w2.tabs[1]);
      w2.activate(w2.tabs[0]);
      await t.until(() => w2.tabs[0].title === 'Page Two' && w2.tabs[0].wc, { message: 'loads when clicked' });
      // pinned can't be dragged between normal tabs
      w2.move(w2.tabs[0], 5);
      t.assert.ok(w2.tabs[0].pinned, 'stays in the pinned group');
      w2.base.close();
      db.kv.set('pinnedTabs', []);
    },
  },
  {
    name: 'manual "Put Tab to Sleep" from the tab menu path; asleep shown in UI; wakes on click',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      const b = w.newTab(t.url('/p2')); await t.loaded(b);
      const a = w.tabs[0];
      t.assert.equal(a.sleep(), true);
      t.assert.equal(b.sleep(), false, 'the visible tab never sleeps');
      await t.until(async () => t.ui(`document.querySelector('.tab.asleep .badge svg') !== null`), { message: 'moon badge' });
      w.activate(a);
      await t.until(() => a.wc && a.title === 'Page One', { message: 'woke' });
    },
  },
  {
    name: 'tab search: lists tabs, filters as you type, Enter switches; reopens a specific closed action',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      const b = w.newTab(t.url('/long')); await t.loaded(b);
      const c = w.newTab(t.url('/p3')); await t.loaded(c);
      const d = w.newTab(t.url('/fav')); await t.loaded(d);
      w.close(d);              // closed action 1
      w.close(c);              // closed action 2 (newest)
      w.activate(w.tabs[0]);
      await t.ui(`document.getElementById('tabsearch-btn').click()`);
      await t.until(async () => !(await t.ui(`document.getElementById('ts-panel').hidden`)), { message: 'panel open' });
      t.assert.ok(w.overlay);
      const titles = () => t.ui(`[...document.querySelectorAll('#ts-list .row-title')].map(e => e.textContent).join('|')`);
      await t.until(async () => (await titles()) === 'Page One|Long Text|Page Three|With Icon', { message: 'open + recently closed' });
      await t.ui(`{ const i = document.getElementById('ts-input'); i.value = 'long'; i.dispatchEvent(new Event('input')); }`);
      t.assert.equal(await titles(), 'Long Text');
      await t.ui(`document.getElementById('ts-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
      await t.until(() => w.active === b && !w.overlay, { message: 'switched + closed' });
      // reopen the OLDER closed action directly (not the newest)
      await t.ui(`document.getElementById('tabsearch-btn').click()`);
      await t.until(async () => /With Icon/.test(await titles()), { message: 'reopened panel' });
      await t.ui(`[...document.querySelectorAll('#ts-list .ts-row')].find(r => r.textContent.includes('With Icon')).click()`);
      await t.until(() => w.tabs.some((x) => x.title === 'With Icon'), { message: 'specific action reopened' });
      t.assert.ok(!w.tabs.some((x) => x.title === 'Page Three'), 'newer action untouched');
      w.reopenClosed();
      await t.until(() => w.tabs.some((x) => x.title === 'Page Three'), { message: '⇧⌘T still has the other one' });
    },
  },
];
