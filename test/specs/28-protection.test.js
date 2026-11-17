// Hex Magic → Protection: ads, trackers and ad popups blocked in every window (on by default); one switch in the wheel.
const protection = require('../../src/main/hex/protection');

module.exports = [
  {
    name: 'Protection: on by default — ad scripts blocked, ad boxes hidden, ad popups stopped (normal popups still open)',
    async run(t) {
      t.settings.set({ adblock: true });
      const w = await t.fresh();
      await t.until(() => protection.ready(), { message: 'lists loaded' });
      await t.go(t.url('/ads'));
      await t.sleep(300);
      t.assert.equal(await t.page('typeof window.__adRan'), 'undefined', 'ad script blocked');
      await t.until(async () => (await t.page(`getComputedStyle(document.getElementById('adbox')).display`)) === 'none', { message: 'ad box hidden' });
      t.assert.ok(await t.page(`getComputedStyle(document.querySelector('h1')).display !== 'none'`), 'content stays');
      const tabs = w.tabs.length;
      await t.page(`document.getElementById('pop').click()`, w.active, true);
      await t.sleep(400);
      t.assert.equal(w.tabs.length, tabs, 'ad popup blocked');
      t.assert.match(w.toast || '', /Blocked an ad popup/);
      await t.page(`document.getElementById('ok').click()`, w.active, true);
      await t.until(() => w.tabs.length === tabs + 1, { message: 'normal popup opens' });
      t.assert.ok(protection.stats.blocked > 0 && protection.stats.popups > 0);
    },
  },
  {
    name: 'Protection: Magic → Protection → Blocking in the wheel turns it off and on; InPrivate windows are protected too',
    async run(t) {
      t.settings.set({ adblock: true });
      const w = await t.fresh();
      await t.until(() => protection.ready(), { message: 'lists loaded' });
      const magic = () => t.hub.hex.list().find((f) => f.id === 'magic').items.find((i) => i.id === 'magic.protection').items.find((i) => i.id === 'magic.protection.on');
      t.assert.equal(magic().on, true);
      t.assert.ok((await t.hub.hex.run(w, 'magic.protection.on')).ok);
      t.assert.equal(t.settings.get('adblock'), false);
      t.assert.equal(magic().on, false);
      await t.go(t.url('/ads'));
      await t.until(async () => (await t.page('window.__adRan')) === 1, { message: 'ads load when off' });
      await t.hub.hex.run(w, 'magic.protection.on');
      t.assert.equal(t.settings.get('adblock'), true);
      await t.go(t.url('/ads') + '?again');
      await t.sleep(300);
      t.assert.equal(await t.page('typeof window.__adRan'), 'undefined', 'blocked again');
      // InPrivate
      const pw = t.hub.create({ isPrivate: true });
      await t.until(() => pw.uiReady, { message: 'private window' });
      pw.active.load(t.url('/ads'));
      await t.loaded(pw.active);
      await t.sleep(300);
      t.assert.equal(await pw.active.wc.executeJavaScript('typeof window.__adRan'), 'undefined', 'InPrivate protected');
      pw.base.close();
    },
  },
  {
    name: 'Protection: an embedded frame from another site can\'t open popups (window.open or a fake link click); the page itself and real link clicks still can',
    async run(t) {
      t.settings.set({ adblock: true });
      const w = await t.fresh();
      await t.go(t.url('/embed'));
      const frame = () => w.active.wc.mainFrame.frames.find((f) => /frame-pop/.test(f.url));
      await t.until(() => frame() && frame().executeJavaScript('!!document.getElementById("real")'), { message: 'frame loaded' });
      const n = w.tabs.length;
      await frame().executeJavaScript(`document.getElementById('wo').click()`, true);
      await frame().executeJavaScript(`document.getElementById('ac').click()`, true);
      t.assert.equal(await frame().executeJavaScript('window.open("/p2")'), null, 'window.open gives nothing');
      await t.sleep(500);
      t.assert.equal(w.tabs.length, n, 'no popups from the embedded frame');
      // (real clicks on real links aren't touched: only window.open and script-made link clicks are stopped —
      //  simulated mouse input can't reach a cross-site frame in tests, so that part is checked by hand)
      // the top page can still open popups
      await t.page(`document.getElementById('top-pop').click()`);
      await t.until(() => w.tabs.length === n + 1, { message: 'top page popup opens' });
      // Protection off → the frame can open popups again (new page load)
      t.settings.set({ adblock: false });
      w.active.load(t.url('/embed'));
      await t.loaded(w.active);
      await t.until(() => frame() && frame().executeJavaScript('!!document.getElementById("wo")'), { message: 'frame reloaded' });
      const m = w.tabs.length;
      await frame().executeJavaScript(`document.getElementById('wo').click()`, true);
      await t.until(() => w.tabs.length === m + 1, { message: 'off: frame popup opens' });
      t.settings.set({ adblock: true });
    },
  },
  {
    name: 'Protection: an embedded frame from another site can\'t replace the page with a third site (the ad redirect trick); same-site is fine',
    async run(t) {
      t.settings.set({ adblock: true });
      const w = await t.fresh();
      await t.go(t.url('/embed'));
      const frame = () => w.active.wc.mainFrame.frames.find((f) => /frame-pop/.test(f.url));
      await t.until(() => frame() && frame().executeJavaScript('!!document.getElementById("topnav")'), { message: 'frame loaded' });
      const tried = [];
      w.active.wc.on('did-start-navigation', (e) => { if (e.isMainFrame) tried.push(e.url); });
      await frame().executeJavaScript(`document.getElementById('topnav').click()`, true);
      await t.sleep(800);
      t.assert.match(w.active.wc.getURL(), /\/embed$/, 'redirect to the ad site stopped: still on the page');
      t.assert.match(w.toast || '', /Blocked an ad redirect/);
      t.assert.equal(require('../../src/main/hex/protection').site('https://www.a.example.co.uk/x'), 'example.co.uk');
      // the frame sending the tab back to the page's own site is allowed
      await frame().executeJavaScript(`document.getElementById('topok').click()`, true);
      await t.until(() => /\/p2$/.test(w.active.wc.getURL()), { message: 'same-site navigation allowed' });
      // off: the trick works again
      t.settings.set({ adblock: false });
      await t.go(t.url('/embed'));
      await t.until(() => frame() && frame().executeJavaScript('!!document.getElementById("topnav")'), { message: 'frame loaded again' });
      tried.length = 0;
      await frame().executeJavaScript(`document.getElementById('topnav').click()`, true);
      await t.until(() => tried.some((u) => /127\.0\.0\.2/.test(u)), { message: 'off: not stopped' });
      t.settings.set({ adblock: true });
    },
  },
  {
    name: 'Protection: Rove\'s extra rules stop the invisible "click anywhere = ad" layer used on streaming sites, under any domain ending',
    async run(t) {
      t.settings.set({ adblock: true });
      await t.fresh();
      await t.until(() => protection.ready(), { message: 'lists loaded' });
      const blocked = (url, page) => protection.blocksPopup(url, page); // same engine as the network blocking
      t.assert.ok(blocked('https://llvpn.com/tag.min.js', 'https://streaming-community.army/'));
      t.assert.ok(blocked('https://brand-new-ads.example/tag.min.js', 'https://streaming-community.army/'), 'new ad domain, same loader');
      t.assert.ok(blocked('https://brand-new-ads.example/tag.min.js', 'https://streamingcommunity.lol/'), 'other domain ending');
      t.assert.ok(!blocked('https://cdn.example/tag.min.js', 'https://news.example/'), 'other sites unaffected');
    },
  },
  {
    name: 'Protection: strict popups — on a chosen site its scripts can\'t open or jump to other sites; real link clicks and same-site popups still work; "Strict here" in the wheel',
    async run(t) {
      t.settings.set({ adblock: true, adblockStrict: ['127.0.0.1'] });
      t.assert.deepEqual(t.settings.get('adblockStrict'), ['127.0.0.1']);
      t.settings.set({ adblockStrict: ['bad site!'] });
      t.assert.deepEqual(t.settings.get('adblockStrict'), ['127.0.0.1'], 'junk refused');
      const w = await t.fresh();
      await t.go(t.url('/strict'));
      const n = w.tabs.length;
      await t.page(`document.getElementById('sp').click()`);
      await t.page(`document.getElementById('jump').click()`);
      await t.sleep(500);
      t.assert.equal(w.tabs.length, n, 'script popup to another site blocked');
      t.assert.match(w.active.wc.getURL(), /\/strict$/, 'script jump to another site blocked');
      await t.page(`document.getElementById('same').click()`);
      await t.until(() => w.tabs.length === n + 1, { message: 'same-site popup opens' });
      // a real click on a real link to another site opens
      const page = w.tabs.find((x) => /\/strict$/.test(x.wc.getURL()));
      w.activate(page);
      await t.sleep(200);
      const at = await t.page(`(() => { const b = document.getElementById('lnk').getBoundingClientRect(); return { x: Math.round(b.x + 10), y: Math.round(b.y + 10) }; })()`, page);
      for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) { page.wc.sendInputEvent({ type, ...at, button: 'left', clickCount: 1 }); await t.sleep(40); }
      await t.until(() => w.tabs.length === n + 2, { message: 'real link click opens' });
      // the wheel: Strict here shows the state for the current site and turns it off
      const strict = () => t.hub.hex.list().find((f) => f.id === 'magic').items.find((i) => i.id === 'magic.protection').items.find((i) => i.id === 'magic.protection.strict');
      w.activate(page);
      t.hub.hex.close(); t.hub.hex._testNoMouse(true); t.hub.hex.open(w);
      t.assert.equal(strict().on, true);
      t.assert.ok((await t.hub.hex.run(w, 'magic.protection.strict')).ok);
      t.assert.deepEqual(t.settings.get('adblockStrict'), []);
      t.hub.hex.close();
      t.settings.set({ adblockStrict: ['streaming-community.*', 'streamingcommunity.*'] });
      t.assert.ok(require('../../src/main/hex/protection').strictOn('https://streaming-community.army/titles/1'), 'any domain ending');
    },
  },
  {
    name: 'Protection: Ghostery\'s in-page scriptlets run in the frame that asked, errors caught (no unhandled rejections, no listener pile-up)',
    async run(t) {
      const ran = [], unhandled = [];
      const onUnhandled = (e) => unhandled.push(e);
      process.on('unhandledRejection', onUnhandled);
      const fake = { scripts: ['ok()', 'boom()'], styles: '' };
      const blocker = { onInjectCosmeticFilters(event) {
        if (fake.styles) event.sender.insertCSS(fake.styles, { cssOrigin: 'user' });
        for (const s of fake.scripts) { try { event.sender.executeJavaScript(s, true); } catch {} } // exactly how Ghostery calls it
      } };
      protection._tameScriptlets(blocker);
      const frame = { detached: false, executeJavaScript: async (code) => { ran.push(code); if (code === 'boom()') throw new Error('Script failed to execute'); } };
      const wc = { isDestroyed: () => false, executeJavaScript: () => { throw new Error('the whole tab must not be used'); }, insertCSS: async () => {} };
      blocker.onInjectCosmeticFilters({ sender: wc, senderFrame: frame, frameId: 1 }, 'https://x.test/', {});
      await t.sleep(100);
      process.off('unhandledRejection', onUnhandled);
      t.assert.deepEqual(ran, ['ok()', 'boom()'], 'ran in the frame that asked');
      t.assert.equal(unhandled.length, 0, 'a failing scriptlet is caught');
    },
  },
];
