// Popups like Chrome: window.open gives the page a real window (in a Rove tab), and only during your click or key.
module.exports = [
  {
    name: 'window.open returns a real window in a new tab: the page can fill it (no empty about:blank tab, no retry loop)',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/popups'));
      const page = w.active, n = w.tabs.length;
      t.assert.equal(await t.page('window.fill()', page), true, 'the page got its window');
      await t.until(() => w.tabs.length === n + 1, { message: 'one new tab' });
      const pop = w.tabs.find((x) => x !== page && w.tabs.indexOf(x) >= 0 && !(x.url || '').includes('/popups'));
      await t.until(() => pop.wc && pop.wc.getTitle() === 'Filled by opener', { message: 'the tab shows what the opener wrote' });
      t.assert.equal(await pop.wc.executeJavaScript(`document.getElementById('x').textContent`), 'hi');
      t.assert.equal(await pop.wc.executeJavaScript('!!window.opener'), true, 'linked to its opener');
      t.assert.ok(t.hub.fromTabWebContents(pop.wc), 'a normal Rove tab');
    },
  },
  {
    name: 'popups need your click: none without one, one per click, script-made link clicks blocked, a flood is stopped',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/popups'));
      const page = w.active, wc = page.wc, n = w.tabs.length;
      // no click: nothing opens (the page gets null)
      t.assert.equal(await wc.executeJavaScript(`window.open('/p2') === null`, false), true);
      await wc.executeJavaScript(`document.getElementById('away').click(); 1`, false);
      await wc.executeJavaScript(`document.getElementById('away').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); 1`, false);
      await t.sleep(400);
      t.assert.equal(w.tabs.length, n, 'nothing opened without a click');
      // one click: one popup, even if the page tries ten
      const opened = await wc.executeJavaScript('window.loop()', true);
      await t.sleep(400);
      t.assert.equal(opened, 1, 'one popup per click');
      t.assert.equal(w.tabs.length, n + 1);
      // a link the user clicks still opens
      w.activate(page);
      await wc.executeJavaScript(`document.getElementById('away').click(); 1`, true);
      await t.until(() => w.tabs.length === n + 2, { message: 'link with a click opens' });
      // flood guard (main process): a 4th popup within 3 s is stopped even with clicks
      w.activate(page);
      for (let i = 0; i < 3; i++) await wc.executeJavaScript(`window.open('/p3'); 1`, true);
      await t.sleep(400);
      t.assert.equal(w.tabs.length, n + 3, 'flood stopped after 3 in a row');
      t.assert.match(w.toast || '', /flood of popups/);
    },
  },
];
