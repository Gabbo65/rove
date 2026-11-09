// Security: the browser's own UI can't be taken over by web content, links to other apps ask first.
const { WebContentsView, dialog } = require('electron');
const { PRELOAD } = require('../../src/main/paths');

module.exports = [
  {
    name: 'UI views never leave their own page or open windows',
    async run(t) {
      const win = await t.fresh();
      for (const [view, run, home] of [[win.chrome, t.ui, 'pb://chrome/'], [win.hud, t.hudJs, 'pb://hud/']]) {
        const opened = await run(`window.open(${JSON.stringify(t.url('/p1'))}) === null`, win);
        t.assert.ok(opened, `${home}: window.open denied`);
        await run(`location.href = ${JSON.stringify(t.url('/p1'))}; 1`, win);
        await t.sleep(400);
        t.assert.ok(view.webContents.getURL().startsWith(home), `${home} stayed home (now ${view.webContents.getURL()})`);
      }
      t.assert.ok(await t.ui(`typeof window.pb === 'object'`, win), 'UI still has its bridge');
      // a UI message from a view that isn't on our UI page is ignored
      t.assert.equal(t.hub.fromChrome(win.active.wc), null, 'a tab is never treated as UI');
    },
  },
  {
    name: 'the UI bridge is never given to a web page',
    async run(t) {
      const v = new WebContentsView({ webPreferences: { preload: PRELOAD.chrome, contextIsolation: true, sandbox: true } });
      try {
        await v.webContents.loadURL(t.url('/p1'));
        t.assert.equal(await v.webContents.executeJavaScript(`typeof window.pb`), 'undefined');
        t.assert.equal(t.hub.fromChrome(v.webContents), null);
      } finally { v.webContents.close(); }
    },
  },
  {
    name: 'links that open another app (mailto:) ask first, and the answer is remembered for the site',
    async run(t) {
      await t.fresh();
      const tab = await t.go(t.url('/p1'));
      const real = dialog.showMessageBox;
      const asked = [];
      dialog.showMessageBox = async (...args) => { asked.push(args.find((a) => a && a.message)); return { response: 1 }; };
      try {
        await t.page(`location.href = 'mailto:someone@example.com'; 1`, tab);
        await t.until(() => asked.length === 1, { message: 'question shown' });
        t.assert.match(asked[0].message, /127\.0\.0\.1|localhost/);
        t.assert.match(asked[0].message, /mailto/);
        t.assert.equal(asked[0].detail, 'mailto:someone@example.com');
        t.assert.equal(asked[0].buttons[asked[0].defaultId], 'Cancel', 'safe default');
        await t.page(`location.href = 'mailto:other@example.com'; 1`, tab);
        await t.sleep(500);
        t.assert.equal(asked.length, 1, 'not asked again after Cancel');
        t.assert.ok(tab.url.startsWith(t.url('/p1')), 'page stays');
      } finally { dialog.showMessageBox = real; }
    },
  },
];
