// Tabs: each tab its own view, only the visible one attached; closing actions and ⇧⌘T undo.
module.exports = [
  {
    name: 'new tab: empty address bar, focused (not the previous tab\'s address)',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      await t.until(async () => (await t.ui(`document.getElementById('url').value`)) === t.url('/p1'), { message: 'p1 shown' });
      w.newTab();
      await t.until(async () => (await t.ui(`{ const i = document.getElementById('url'); document.activeElement === i && i.value === '' }`)),
        { message: 'new tab: address bar empty and focused' });
      await t.sleep(500);
      t.assert.equal(await t.ui(`document.getElementById('url').value`), '', 'stays empty');
      t.assert.ok(w.chrome.webContents.isFocused(), 'keyboard focus is in the toolbar, not the page');
      t.assert.ok(!w.active.wc.isFocused(), 'the new tab page does not take the focus');
      const nt = w.active;
      w.activate(w.tabs[0]);
      await t.sleep(300);
      w.activate(nt); // switching back to an open New Tab focuses the address bar too
      await t.sleep(500);
      t.assert.ok(w.chrome.webContents.isFocused() && !nt.wc.isFocused(), 'focus on switching back');
    },
  },
  {
    name: 'new tab: after typing an address and Enter, the address bar shows the new page',
    async run(t) {
      const w = await t.fresh();
      w.newTab();
      await t.until(async () => t.ui(`document.activeElement === document.getElementById('url') && document.querySelectorAll('.tab').length === 2`), { message: 'focused' });
      await t.loaded(w.active);
      const target = t.url('/p2');
      // type (opens the suggestions popup = overlay), then Enter
      await t.ui(`{ const i = document.getElementById('url'); i.value = ${JSON.stringify(target.replace(/^http:\/\//, ''))};
        i.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: 'x' })); }`);
      await t.until(async () => t.ui(`!document.getElementById('suggest').hidden`), { message: 'suggestions open' });
      await t.ui(`document.getElementById('urlform').requestSubmit()`);
      await t.until(() => w.active.title === 'Page Two', { message: 'navigated' }).catch((e) => { throw new Error(`${e.message} (at ${w.active.url})`); });
      await t.sleep(500);
      t.assert.notEqual(await t.ui(`document.activeElement.id`), 'url', 'the address bar lets go of the focus');
      t.assert.equal(await t.ui(`document.getElementById('url').value`), target, 'address bar shows the page address');
    },
  },
  {
    name: 'favicon: found without an icon tag, kept across same-site pages',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/fav'));
      await t.until(() => w.active.favicon === t.url('/icon.png'), { message: 'icon tag' });
      await t.go(t.url('/p1')); // same site, no icon tag → the site's /favicon.ico
      await t.until(() => w.active.favicon === t.url('/favicon.ico'), { message: 'site favicon.ico' });
      w.active.back();
      await t.until(() => w.active.title === 'With Icon' && w.active.favicon === t.url('/icon.png'), { message: 'icon again after back' });
    },
  },
  {
    name: 'new / activate / close; only the active page is attached to the window',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      const b = w.newTab(t.url('/p2'));
      const c = w.newTab(t.url('/p3'), { background: true });
      t.assert.equal(w.active, b);
      t.assert.deepEqual(w.tabs.map((x) => x.id), [w.tabs[0].id, b.id, c.id]);
      const attached = w.base.contentView.children;
      t.assert.ok(attached.includes(b.view) && !attached.includes(c.view) && !attached.includes(w.tabs[0].view));
      w.activate(c);
      t.assert.ok(w.base.contentView.children.includes(c.view) && !w.base.contentView.children.includes(b.view));
      w.close(c);
      t.assert.equal(w.tabs.length, 2);
      t.assert.equal(w.active, b, 'closing the active tab activates its neighbour');
    },
  },
  {
    name: 'UI shows the tabs from the main process state',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      w.newTab(t.url('/p2'));
      await t.until(async () => (await t.ui(`[...document.querySelectorAll('.tab .title')].map(e => e.textContent).join('|')`)) === 'Page One|Page Two',
        { message: 'tab titles in UI' });
      const activeIdx = await t.ui(`[...document.querySelectorAll('.tab')].findIndex(e => e.classList.contains('active'))`);
      t.assert.equal(activeIdx, 1);
      // clicking a tab in the UI activates it
      await t.ui(`document.querySelectorAll('.tab')[0].dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))`);
      await t.until(() => w.active === w.tabs[0], { message: 'activated by click' });
    },
  },
  {
    name: '⇧⌘T undoes closing actions in order, with back/forward history',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      await t.go(t.url('/p2'));                     // tab A: p1 → p2
      const b = w.newTab(t.url('/p3')); await t.loaded(b);
      const c = w.newTab(t.url('/long')); await t.loaded(c);
      const d = w.newTab(t.url('/fav')); await t.loaded(d);
      const titles = () => w.tabs.map((x) => x.title).join('|');
      w.close(b);                                         // action 1: one tab
      w.closeMany(w.tabs.slice(1));                       // action 2: two tabs at once
      t.assert.equal(titles(), 'Page Two');
      w.reopenClosed();
      await t.until(() => titles() === 'Page Two|Long Text|With Icon', { message: 'undo #1 (two tabs)' });
      w.reopenClosed();
      await t.until(() => titles() === 'Page Two|Page Three|Long Text|With Icon', { message: 'undo #2 (one tab, in place)' });
      // back history survives close + reopen
      w.close(w.tabs[0]);
      w.reopenClosed();
      const a = w.tabs[0];
      await t.until(() => a.title === 'Page Two' && a.canGoBack(), { message: 'history restored' });
      a.back();
      await t.until(() => a.title === 'Page One', { message: 'back to p1 after reopen' });
    },
  },
  {
    name: 'closing the window is one action; reopening restores it into a lone New Tab',
    async run(t) {
      let w = await t.fresh();
      await t.go(t.url('/p1'));
      const x = w.newTab(t.url('/p2')); await t.loaded(x);
      w.closing = false;
      w.base.close();
      await t.until(() => t.hub.all().length === 0, { message: 'window closed' });
      w = t.hub.create();
      await t.until(() => w.uiReady && w.active?.wc, { message: 'new window' });
      t.assert.equal(w.tabs.length, 1);
      w.reopenClosed();
      await t.until(() => w.tabs.map((y) => y.title).join('|') === 'Page One|Page Two', { message: 'window restored, blank replaced' });
    },
  },
  {
    name: 'drag a tab: follows the mouse only horizontally, stops at the row edge, reorders',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      const b = w.newTab(t.url('/p2')); await t.loaded(b);
      const c = w.newTab(t.url('/p3')); await t.loaded(c);
      await t.until(async () => (await t.ui(`document.querySelectorAll('.tab').length`)) === 3, { message: 'ui tabs' });
      const r = await t.ui(`(() => { const b = document.querySelectorAll('.tab')[0].getBoundingClientRect(), f = document.querySelectorAll('.tab .fav')[0].getBoundingClientRect();
        return { x: f.left + f.width / 2, y: f.top + f.height / 2, top: b.top }; })()`);
      // grabbed by its icon; wander down into the page and far past the right edge of the window
      const seen = await t.mouseDrag({ x: r.x, y: r.y }, [
        { x: r.x + 20, y: r.y + 5 }, { x: r.x + 150, y: r.y + 300 }, { x: r.x + 400, y: r.y + 600 }, { x: 1275, y: 840 },
      ], '.tab');
      const during = seen.filter(Boolean);
      t.assert.ok(during.length >= 3, 'tab was dragging');
      for (const s of during) {
        t.assert.ok(Math.abs(s.top - r.top) < 1, `stays on its row (top ${s.top})`);
        t.assert.ok(s.right <= s.rowRight + 1 && s.left >= s.rowLeft - 1, 'stays inside the tab row');
      }
      await t.until(() => w.tabs.map((y) => y.title).join('|') === 'Page Two|Page Three|Page One', { message: 'moved to the end' });
      // a plain click still just activates
      w.activate(w.tabs[0]);
      const r2 = await t.ui(`(() => { const b = document.querySelectorAll('.tab')[2].getBoundingClientRect(); return { x: b.left + 40, y: b.top + 15 }; })()`);
      await t.mouseDrag({ x: r2.x, y: r2.y }, [{ x: r2.x + 2, y: r2.y }], '.tab');
      await t.until(() => w.active === w.tabs[2], { message: 'click activates' });
      t.assert.equal(w.tabs.map((y) => y.title).join('|'), 'Page Two|Page Three|Page One', 'no reorder on click');
    },
  },
];
