// The UI layering: popups lift the toolbar UI above the page and close on outside clicks; QR button; screenshots.
module.exports = [
  {
    name: 'popups lift the UI above the page; clicking the page area closes them',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      t.assert.equal(w.base.contentView.children[0], w.chrome);
      await t.ui(`document.getElementById('hist-btn').click()`);
      await t.until(() => w.overlay && w.base.contentView.children.at(-1) === w.chrome, { message: 'UI on top' });
      // a click on the (transparent) page area closes the popup and puts the page back on top
      await t.ui(`document.getElementById('stage').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 400, clientY: 500 }))`);
      await t.until(() => !w.overlay && w.base.contentView.children.at(-1) !== w.chrome, { message: 'page back on top' });
      t.assert.ok(await t.ui(`document.getElementById('hist-panel').hidden`));
      // Escape also closes
      await t.ui(`document.getElementById('hist-btn').click()`);
      await t.until(() => w.overlay, { message: 'open again' });
      await t.ui(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await t.until(() => !w.overlay, { message: 'Esc closes' });
    },
  },
  {
    name: 'QR: shown with no phone, the button always toggles it',
    async run(t) {
      const w = await t.fresh();
      w.toggleQR(true);
      await t.until(() => w.hudSize.height > 150, { message: 'QR visible in hud' });
      await t.ui(`document.getElementById('remote-btn').click()`);
      await t.until(() => !w.qrVisible && w.hudSize.height === 0, { message: 'hidden by button' });
      await t.ui(`document.getElementById('remote-btn').click()`);
      await t.until(() => w.qrVisible && w.hudSize.height > 150, { message: 'shown by button' });
    },
  },
  {
    name: 'QR: "Show the QR code when no phone is connected" — off = no pop-up; needs the phone remote on',
    async run(t) {
      t.settings.set({ remoteEnabled: true, remoteQrAuto: false });
      let w = await t.fresh();
      t.assert.equal(w.qrVisible, false, 'new window: no QR');
      await t.ui(`document.getElementById('remote-btn').click()`);
      await t.until(() => w.qrVisible && w.hudSize.height > 150, { message: 'the button still shows it' });
      w.toggleQR(false);
      t.settings.set({ remoteQrAuto: true });
      await t.until(() => w.qrVisible, { message: 'turned on → shown (no phone connected)' });
      // the settings page: greyed out while the phone remote is off, choice kept
      await t.go('pb://settings/#remote');
      await t.until(async () => t.page(`document.getElementById('remoteQrAuto').checked && !document.getElementById('remoteQrAuto').disabled`), { message: 'switch on' });
      await t.page(`document.querySelector('[data-setting=remoteEnabled]').click()`);
      await t.until(async () => t.page(`{ const b = document.getElementById('remoteQrAuto'); b.disabled && !b.checked }`), { message: 'greyed out with the remote off' });
      t.assert.equal(w.qrVisible, false, 'remote off → QR not shown by itself');
      t.assert.equal(t.settings.get('remoteQrAuto'), true, 'choice kept');
      await t.page(`document.querySelector('[data-setting=remoteEnabled]').click()`);
      await t.until(async () => t.page(`{ const b = document.getElementById('remoteQrAuto'); !b.disabled && b.checked }`), { message: 'back with the remote on' });
      await t.until(() => w.qrVisible, { message: 'QR back' });
      await t.page(`document.getElementById('remoteQrAuto').click()`);
      await t.until(() => t.settings.get('remoteQrAuto') === false && !w.qrVisible, { message: 'switched off from the page' });
      t.settings.set({ remoteEnabled: true, remoteQrAuto: true });
      // shortcut: ⇧⌘P (⇧⌘Q logs you out of macOS)
      const item = require('electron').Menu.getApplicationMenu().items.flatMap((m) => m.submenu?.items || []).find((i) => i.label === 'Show Remote QR Code');
      t.assert.equal(item.accelerator, 'CmdOrCtrl+Shift+P');
    },
  },
  {
    name: 'screenshots: page + toolbar, popup over page, find bar + QR',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/long'));
      const b = w.newTab(t.url('/fav')); await t.loaded(b);
      w.toggleQR(true);
      await t.sleep(300);
      const f1 = await t.snapshot('ui-1-page');
      await t.ui(`document.getElementById('hist-btn').click()`);
      await t.until(() => w.overlay, { message: 'popup' });
      await t.sleep(250);
      const f2 = await t.snapshot('ui-2-popup');
      await t.ui(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      w.activate(w.tabs[0]);
      w.openFind();
      await t.hudJs(`{ const i = document.getElementById('find-input'); i.value = 'browser'; i.dispatchEvent(new Event('input')); }`);
      await t.sleep(400);
      const f3 = await t.snapshot('ui-3-find-qr');
      for (const f of [f1, f2, f3]) t.assert.ok(require('fs').statSync(f).size > 10_000, `${f} has content`);
    },
  },
];
