// Layout: toolbar buttons on/off + order, Home button, vertical tabs.
const DEFAULT = { toolbarLayout: ['back', 'forward', 'reload', 'address', 'history', 'downloads', 'remote', 'menu'], tabsPosition: 'top', startPage: 'newtab', startUrl: '' };
const visibleToolbar = `[...document.getElementById('toolbar').children].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.id).join(',')`;

module.exports = [
  {
    name: 'toolbar: chosen buttons in the chosen order; address bar and menu can\'t be hidden; Home goes to the start page',
    async run(t) {
      t.settings.set(DEFAULT);
      require('../../src/main/downloads').action(null, 'clear'); // the downloads button only shows with downloads
      const w = await t.fresh();
      await t.until(async () => (await t.ui(visibleToolbar)) === 'back,forward,reload,urlform,hist-btn,remote-btn,menu-btn', { message: 'default toolbar' });
      t.settings.set({ toolbarLayout: ['home', 'address', 'back', 'menu'] });
      await t.until(async () => (await t.ui(visibleToolbar)) === 'home-btn,urlform,back,menu-btn', { message: 'custom toolbar' });
      // invalid layouts are refused
      for (const bad of [['back', 'menu'], ['address'], ['address', 'menu', 'menu'], ['address', 'menu', 'evil'], 'address,menu']) {
        t.settings.set({ toolbarLayout: bad });
        t.assert.deepEqual(t.settings.get('toolbarLayout'), ['home', 'address', 'back', 'menu'], `refused ${JSON.stringify(bad)}`);
      }
      // Home: New Tab page, or the start page from Settings → General
      await t.go(t.url('/p1'));
      await t.ui(`document.getElementById('home-btn').click()`);
      await t.until(() => w.active.url === 'pb://newtab/', { message: 'home = new tab' });
      t.settings.set({ startPage: 'url', startUrl: t.url('/p2') });
      await t.ui(`document.getElementById('home-btn').click()`);
      await t.until(() => w.active.title === 'Page Two', { message: 'home = start page' });
      // a hidden button's popup still opens (⇧⌘J), placed under the menu button instead
      w.sendUI('command', { name: 'downloads' });
      await t.until(async () => t.ui(`!document.getElementById('dl-panel').hidden`), { message: 'downloads panel' });
      const right = await t.ui(`parseFloat(document.getElementById('dl-panel').style.right)`);
      t.assert.ok(right < 100, `panel near the right edge (right: ${right}px)`);
      t.settings.set(DEFAULT);
    },
  },
  {
    name: 'vertical tabs: sidebar on the left, page beside it, tabs stacked and draggable up/down',
    async run(t) {
      t.settings.set(DEFAULT);
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      w.newTab(t.url('/p2')); await t.loaded(w.active);
      w.newTab(t.url('/p3')); await t.loaded(w.active);
      t.settings.set({ tabsPosition: 'left' });
      await t.until(async () => t.ui(`document.body.classList.contains('vtabs') && document.getElementById('side').contains(document.getElementById('tabstrip'))`), { message: 'sidebar' });
      await t.until(() => w.active.view.getBounds().x === 240, { message: `page beside the sidebar (${JSON.stringify(w.active.view.getBounds())})` });
      const top = await t.ui(`document.getElementById('top').getBoundingClientRect().height`);
      t.assert.equal(w.active.view.getBounds().y, Math.round(top), 'page right under the toolbar');
      const boxes = await t.ui(`[...document.querySelectorAll('.tab')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; })`);
      t.assert.ok(boxes[1].y > boxes[0].y && boxes[2].y > boxes[1].y && boxes[0].w > 200, 'stacked, full width');
      // drag the first tab below the last
      const first = w.tabs[0];
      await t.mouseDrag({ x: boxes[0].x, y: boxes[0].y }, [1, 2, 3, 4, 5, 6].map((i) => ({ x: boxes[0].x, y: boxes[0].y + i * 18 })).concat([{ x: boxes[0].x, y: boxes[2].y + 10 }]), '.tab');
      await t.until(() => w.tabs[2] === first, { message: `dragged down (${w.tabs.map((x) => x.title)})` });
      // clicking a tab in the sidebar activates it
      await t.ui(`document.querySelectorAll('.tab')[0].dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))`);
      await t.until(() => w.active === w.tabs[0], { message: 'activated' });
      t.settings.set({ tabsPosition: 'top' });
      await t.until(async () => t.ui(`!document.body.classList.contains('vtabs') && document.getElementById('top').firstElementChild.id === 'tabstrip'`), { message: 'back on top' });
      await t.until(() => w.active.view.getBounds().x === 0, { message: 'page full width again' });
    },
  },
  {
    name: 'Settings → Toolbar buttons: switches, drag to reorder, default; tabs position',
    async run(t) {
      t.settings.set(DEFAULT);
      await t.fresh();
      await t.go('pb://settings/#appearance');
      await t.until(async () => (await t.page(`document.querySelectorAll('#tb-list .tb-row').length`)) === 9, { message: 'rows' });
      t.assert.equal(await t.page(`document.querySelectorAll('#tb-list .tb-row .fixed').length`), 2, 'address + menu fixed');
      await t.page(`document.querySelector('#tb-list [data-id=remote] input').click()`);
      await t.until(() => !t.settings.get('toolbarLayout').includes('remote'), { message: 'remote off' });
      await t.page(`document.querySelector('#tb-list [data-id=home] input').click()`);
      await t.until(() => t.settings.get('toolbarLayout').includes('home'), { message: 'home on' });
      // drag "Reload" above "Back"
      await t.page(`{
        const list = document.getElementById('tb-list'), from = list.querySelector('[data-id=reload]'), to = list.querySelector('[data-id=back]');
        const dt = new DataTransfer(), r = to.getBoundingClientRect();
        from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r.top + 2 }));
        to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r.top + 2 }));
        from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      }`);
      await t.until(() => t.settings.get('toolbarLayout').join(',') === 'reload,back,forward,address,history,downloads,menu,home', { message: `reordered (${t.settings.get('toolbarLayout')})` });
      await t.page(`document.querySelector('#tabsPosition [data-v=left]').click()`);
      await t.until(() => t.settings.get('tabsPosition') === 'left', { message: 'tabs left' });
      await t.page(`document.getElementById('tb-reset').click()`);
      await t.until(() => t.settings.get('toolbarLayout').join(',') === DEFAULT.toolbarLayout.join(',') && t.settings.get('tabsPosition') === 'top', { message: 'default toolbar' });
      t.settings.set(DEFAULT);
    },
  },
];
