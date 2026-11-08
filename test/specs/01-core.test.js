// Core browsing: start page, typing addresses/searches, back/forward, error page, crash recovery, safety rules.
const urls = require('../../src/main/urls');

module.exports = [
  {
    name: 'starts with one New Tab, page view placed under the toolbar',
    async run(t) {
      const w = await t.fresh();
      t.assert.equal(w.tabs.length, 1);
      t.assert.equal(w.active.url, 'pb://newtab/');
      t.assert.ok(w.content.y > 60, 'content area starts below the toolbar');
      t.assert.deepEqual(w.active.view.getBounds(), w.content);
      // only UI + active page attached (hud/cursor only when shown)
      t.assert.ok(w.base.contentView.children.includes(w.active.view));
      t.assert.equal(w.base.contentView.children[0], w.chrome, 'UI is at the bottom when no popup is open');
    },
  },
  {
    name: 'address bar: hosts, URLs and searches',
    async run(t) {
      t.assert.equal(urls.fromInput('example.com'), 'https://example.com');
      t.assert.equal(urls.fromInput('localhost:3000/x'), 'http://localhost:3000/x');
      t.assert.equal(urls.fromInput('192.168.1.2'), 'http://192.168.1.2');
      t.assert.match(urls.fromInput('how tall is everest'), /^https:\/\/www\.google\.com\/search\?q=how%20tall/);
      t.assert.equal(urls.fromInput('pb://settings'), 'pb://settings');
      t.assert.equal(urls.fromInput('pb://chrome/index.html'), null, 'UI pages cannot be opened as tabs');
      const w = await t.fresh();
      const tab = await t.go(t.url('/p1'));
      t.assert.equal(tab.title, 'Page One');
      t.assert.equal(tab.state().url, t.url('/p1'));
      // typed into the UI address bar
      await t.ui(`document.getElementById('url').value = ${JSON.stringify(t.url('/p2'))};
        document.getElementById('urlform').requestSubmit()`);
      await t.until(() => w.active.title === 'Page Two', { message: 'typed navigation' });
      const shown = await t.ui(`document.getElementById('url').value`);
      t.assert.equal(shown, t.url('/p2'));
    },
  },
  {
    name: 'back / forward / toolbar buttons follow the tab',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      await t.go(t.url('/p2'));
      t.assert.ok(w.active.canGoBack());
      await t.until(async () => !(await t.ui(`document.getElementById('back').disabled`)), { message: 'back enabled in UI' });
      w.active.back();
      await t.until(() => w.active.title === 'Page One', { message: 'went back' });
      t.assert.ok(w.active.canGoForward());
      w.active.forward();
      await t.until(() => w.active.title === 'Page Two', { message: 'went forward' });
    },
  },
  {
    name: 'unreachable site shows the error page, address bar keeps the address, retry works',
    async run(t) {
      const w = await t.fresh();
      const dead = 'http://127.0.0.1:59999/nothing'; // nothing listens there
      w.navigate(dead);
      await t.until(() => urls.internalPage(w.active.url) === 'error', { message: 'error page' });
      const s = w.active.state();
      t.assert.equal(s.url, dead);
      t.assert.equal(s.internal, 'error');
      await t.loaded(w.active);
      const text = await t.page('document.body.innerText');
      t.assert.match(text, /can’t reach this page/i);
      // Retry from the page goes back to the failing address (and fails again → still the error page)
      await t.page(`document.getElementById('retry').click()`);
      await t.until(() => w.active.loading === false && w.active.state().url === dead, { message: 'retried' });
    },
  },
  {
    name: 'web pages cannot open pb:// pages; pb pages get the page API, web pages do not',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/links'));
      t.assert.equal(await t.page('typeof (window.pb && window.pb.call)'), 'undefined', 'no bridge on web pages');
      await t.page(`document.getElementById('pb').click()`);
      await t.sleep(500);
      t.assert.equal(w.active.title, 'Links', 'navigation to pb:// was blocked');
      await t.go('pb://newtab/');
      t.assert.equal(await t.page('typeof window.pb.call'), 'function');
    },
  },
  {
    name: 'target=_blank opens a tab next to its opener',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/links'));
      await t.page(`document.getElementById('blank').click()`);
      await t.until(() => w.tabs.length === 2, { message: 'new tab' });
      t.assert.equal(w.tabs[1].openerId, w.tabs[0].id);
      await t.until(() => w.tabs[1].title === 'Page Two', { message: 'opened page' });
    },
  },
  {
    name: 'a crashed page reloads itself',
    async run(t) {
      const w = await t.fresh();
      const tab = await t.go(t.url('/p1'));
      const before = tab.wc.getOSProcessId();
      tab.wc.forcefullyCrashRenderer();
      await t.until(() => tab.wc && !tab.wc.isCrashed() && tab.wc.getOSProcessId() !== before && tab.title === 'Page One',
        { message: 'reloaded after crash', timeout: 10000 });
    },
  },
  {
    name: 'page fullscreen fills the window, leaving restores the layout',
    async run(t) {
      const w = await t.fresh();
      const tab = await t.go(t.url('/fullscreen'));
      await t.page(`document.getElementById('v').requestFullscreen(); 1`);
      await t.until(() => w.fullscreenTab === tab, { message: 'fullscreen entered' });
      const [cw, ch] = w.base.getContentSize();
      await t.until(() => tab.view.getBounds().width === w.base.getContentSize()[0], { message: 'page fills window' });
      t.assert.ok(cw > 0 && ch > 0);
      await t.page('document.exitFullscreen(); 1');
      await t.until(() => !w.fullscreenTab, { message: 'fullscreen left' });
      await t.until(() => JSON.stringify(tab.view.getBounds()) === JSON.stringify(w.content), { message: 'layout restored' });
    },
  },
];
