// Hex Phase 1: one core in the main process, the radial wheel at the mouse, family navigation, Hex Trigger.
const { Menu } = require('electron');

const wjs = (t, code) => t.hub.hex.wheelWindow().webContents.executeJavaScript(code);
const hexState = (t) => wjs(t, `(() => { const r = document.getElementById('hex'); return { open: !r.hidden,
  sectors: [...r.querySelectorAll('.hx-sector')].map((g) => g.getAttribute('aria-label')),
  on: [...r.querySelectorAll('.hx-sector.on')].map((g) => g.dataset.i).join(),
  back: !!r.querySelector('.hx-hub.back'), caption: r.querySelector('.hx-caption')?.textContent || '',
  box: r.querySelector('.hx-wheel').getBoundingClientRect().toJSON(), vw: innerWidth, vh: innerHeight }; })()`);
const key = (t, k, extra = '') => wjs(t, `document.getElementById('hex').dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true, cancelable: true ${extra} }))`);
const move = (t, x, y) => wjs(t, `document.dispatchEvent(new MouseEvent('mousemove', { clientX: ${x}, clientY: ${y}, screenX: ${x}, screenY: ${y}, bubbles: true }))`);

module.exports = [
  {
    name: 'Hex wheel: full size inside the window; moving toward a family enters it (wheel becomes the family), centre goes back',
    async run(t) {
      t.settings.set({ hexTrigger: 'Alt+H' });
      const w = await t.fresh();
      t.hub.hex._testNoMouse(true); // before it shows: the real mouse must never reach the wheel
      t.hub.hex.close(); t.hub.hex.open(w);
      await t.until(async () => (await hexState(t)).open, { message: 'wheel open' });
      await t.sleep(250); // open animation
      let s = await hexState(t);
      t.assert.deepEqual(s.sectors, ['Injector', 'Magic', 'Settings', 'Extract']);
      t.assert.ok(s.box.width > 200 && s.box.height > 200, `real size (${s.box.width}px)`);
      t.assert.ok(s.box.left >= 0 && s.box.top >= 0 && s.box.right <= s.vw && s.box.bottom <= s.vh, 'inside the window');
      t.assert.ok(t.hub.hex.wheelWindow().isAlwaysOnTop(), 'own always-on-top window');
      t.assert.ok(t.hub.hex.wheelWindow().isVisible(), 'wheel window visible');
      if (process.platform === 'darwin') t.assert.ok(require('electron').app.dock.isVisible(), 'Rove keeps its Dock icon');
      const c = { x: s.box.left + s.box.width / 2, y: s.box.top + s.box.height / 2 };
      // the mouse resting over a family when the wheel opens (pushed in from a screen edge) doesn't enter it
      await move(t, c.x - 40, c.y + 40);
      t.assert.deepEqual((await hexState(t)).sectors, ['Injector', 'Magic', 'Settings', 'Extract'], 'resting mouse enters nothing');
      await move(t, c.x + 5, c.y + 5);
      t.assert.equal((await hexState(t)).back, false, 'dead zone: nothing');
      await move(t, c.x - 40, c.y + 40); // toward Settings (bottom-left): the wheel becomes Settings
      s = await hexState(t);
      t.assert.ok(s.back && s.sectors.join() === 'Trigger,Mode,Size,Color', JSON.stringify(s));
      t.assert.equal(s.on, '', 'moving only enters, never runs or highlights by itself');
      await move(t, c.x, c.y - 60); // inside: toward Trigger (a command, top) only highlights it
      s = await hexState(t);
      t.assert.ok(s.back && s.sectors.join() === 'Trigger,Mode,Size,Color', 'still in Settings');
      t.assert.match(s.caption, /Trigger/);
      t.assert.equal(w.active.url, 'pb://newtab/', 'nothing ran');
      // centre button = back to the four families
      await wjs(t, `document.querySelector('#hex .hx-hub').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
      s = await hexState(t);
      t.assert.ok(!s.back && s.sectors.length === 4, 'back to the root wheel');
      // keyboard: 1 = Injector, Esc back, Esc closes
      await key(t, '1');
      s = await hexState(t);
      t.assert.ok(s.back && s.sectors.join() === 'JavaScript,CSS,HTML,Scripts…', JSON.stringify(s));
      await key(t, 'Escape');
      t.assert.equal((await hexState(t)).sectors.length, 4);
      await key(t, 'Escape');
      await t.until(async () => !(await hexState(t)).open && !t.hub.hex.wheelWindow().isVisible(), { message: 'closed' });
    },
  },
  {
    name: 'Hex: settings live in the wheel — Color ring (stays open, recolors), Trigger recorder; ids only, junk refused',
    async run(t) {
      t.settings.set({ hexColor: 'violet', hexTrigger: 'Alt+H' });
      const w = await t.fresh();
      t.assert.match((await t.hub.hex.run(w, 'nope')).error, /Unknown/);
      t.assert.match((await t.hub.hex.run(w, { evil: 1 })).error, /Unknown/);
      t.assert.match((await t.hub.hex.run(w, 'hex.color')).error, /Not a command/);
      t.assert.match(t.hub.hex.set('downloadDir', '/evil').error, /Not allowed/);
      t.assert.throws(() => t.hub.hex.register({ id: 'x', family: 'nope', run() {} }), /bad item/);
      t.hub.hex._testNoMouse(true); // before it shows: the real mouse must never reach the wheel
      t.hub.hex.close(); t.hub.hex.open(w);
      await t.until(async () => (await hexState(t)).open, { message: 'open' });
      await key(t, '3');             // Settings ring (Trigger selected)
      await key(t, 'ArrowLeft');     // Color (Trigger → ← wraps to the last: Color)
      await key(t, 'Enter');         // deeper: the color ring
      let s = await hexState(t);
      t.assert.equal(s.sectors.length, 7, JSON.stringify(s));
      t.assert.ok(s.back);
      await wjs(t, `document.querySelector('#hex .hx-sector[aria-label="Blue"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
      await t.until(() => t.settings.get('hexColor') === 'blue', { message: 'color saved' });
      await t.until(async () => (await wjs(t, `document.getElementById('hex').dataset.color`)) === 'blue', { message: 'wheel recolored, still open' });
      t.assert.ok(await wjs(t, `!!document.querySelector('#hex .hx-sector.cur[aria-label="Blue"]')`), 'current color marked');
      t.assert.equal(w.active.url, 'pb://newtab/', 'never opened Rove settings');
      // back one level, then record a new Trigger right in the wheel
      await wjs(t, `document.querySelector('#hex .hx-hub').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
      t.assert.deepEqual((await hexState(t)).sectors, ['Trigger', 'Mode', 'Size', 'Color']);
      await wjs(t, `document.querySelector('#hex .hx-sector[aria-label="Trigger"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
      await key(t, 'k', ", code: 'KeyK', altKey: true");
      await t.until(() => t.settings.get('hexTrigger') === 'Alt+K', { message: 'trigger recorded in the wheel' });
      t.assert.match((await hexState(t)).caption, /Now/);
      t.settings.set({ hexColor: 'violet', hexTrigger: 'Alt+H' });
    },
  },
  {
    name: 'Hex Trigger: setting validated, menu shortcut follows it, recorder in Settings → Hex',
    async run(t) {
      t.settings.set({ hexTrigger: 'Alt+H' });
      const item = () => Menu.getApplicationMenu().items.flatMap((m) => m.submenu?.items || []).find((i) => i.label === 'Hex');
      t.assert.equal(item().accelerator, 'Alt+H');
      for (const bad of ['H', 'Shift+H', 'Alt+', 'Alt+H; rm -rf', 42]) {
        t.settings.set({ hexTrigger: bad });
        t.assert.equal(t.settings.get('hexTrigger'), 'Alt+H', `refused ${bad}`);
      }
      await t.fresh();
      await t.go('pb://settings/#hex');
      await t.until(async () => (await t.page(`document.getElementById('hex-trigger').textContent`)).length > 0, { message: 'shown' });
      await t.page(`document.getElementById('hex-trigger-set').click();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', altKey: true, bubbles: true, cancelable: true }))`);
      await t.until(() => t.settings.get('hexTrigger') === 'Alt+J', { message: 'recorded Alt+J' });
      await t.until(() => item().accelerator === 'Alt+J', { message: 'menu follows' });
      t.settings.set({ hexTrigger: 'Alt+H' });
      // the trigger is caught before a text box sees it (⌥H would type "˙") and opens the wheel
      const { matches } = require('../../src/main/hex');
      t.assert.ok(matches('Alt+H', { type: 'keyDown', code: 'KeyH', alt: true }));
      t.assert.ok(!matches('Alt+H', { type: 'keyDown', code: 'KeyH', alt: true, shift: true }));
      t.assert.ok(!matches('Alt+H', { type: 'keyDown', code: 'KeyH' }));
      t.assert.ok(matches('CmdOrCtrl+Shift+K', { type: 'keyDown', code: 'KeyK', shift: true, [process.platform === 'darwin' ? 'meta' : 'control']: true }));
      const w = await t.fresh();
      await t.go(t.url('/form'));
      await t.page(`document.getElementById('user').focus(); 1`);
      w.active.wc.sendInputEvent({ type: 'keyDown', keyCode: 'H', modifiers: ['alt'] });
      w.active.wc.sendInputEvent({ type: 'char', keyCode: '˙', modifiers: ['alt'] });
      w.active.wc.sendInputEvent({ type: 'keyUp', keyCode: 'H', modifiers: ['alt'] });
      await t.until(async () => (await hexState(t)).open, { message: 'trigger in a text box opens Hex' });
      t.assert.equal(await t.page(`document.getElementById('user').value`), '', 'nothing typed');
    },
  },
  {
    name: 'Hex Mode: Smooth opens families and groups on hover; Bumpy needs clicks; entering re-centres the wheel on the mouse',
    async run(t) {
      t.settings.set({ hexMode: 'bumpy' });
      const w = await t.fresh();
      t.hub.hex._testNoMouse(true); // before it shows: the real mouse must never reach the wheel
      t.hub.hex.close(); t.hub.hex.open(w);
      await t.until(async () => (await hexState(t)).open, { message: 'open' });
      const hoverSector = (label) => wjs(t, `document.querySelector('#hex .hx-sector[aria-label="${label}"]').dispatchEvent(new MouseEvent('mouseenter')); 1`);
      await hoverSector('Settings');
      let s = await hexState(t);
      t.assert.ok(!s.back && s.on === '2', `bumpy: hover only highlights (${JSON.stringify(s)})`);
      await wjs(t, `document.querySelector('#hex .hx-sector[aria-label="Settings"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); 1`);
      t.assert.ok((await hexState(t)).back, 'bumpy: click enters');
      // switch to Smooth from the wheel itself (Settings → Mode → Smooth)
      await wjs(t, `document.querySelector('#hex .hx-sector[aria-label="Mode"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); 1`);
      await wjs(t, `document.querySelector('#hex .hx-sector[aria-label="Smooth"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); 1`);
      await t.until(() => t.settings.get('hexMode') === 'smooth', { message: 'mode saved' });
      await key(t, 'Escape'); await key(t, 'Escape');
      s = await hexState(t);
      t.assert.equal(s.sectors.length, 4, 'back at the families');
      await hoverSector('Settings');
      t.assert.ok((await hexState(t)).back, 'smooth: hover enters');
      await hoverSector('Color');
      t.assert.equal((await hexState(t)).sectors.length, 7, 'smooth: hover enters groups too');
      await hoverSector('Red');
      t.assert.equal(t.settings.get('hexColor'), 'violet', 'a command never runs on hover');
      // re-centring: the wheel's centre goes to the mouse (kept on the screen)
      const { screen } = require('electron');
      const ww = t.hub.hex.wheelWindow();
      ww.setPosition(ww.getPosition()[0] + 37, ww.getPosition()[1] + 23);
      t.hub.hex.recenter();
      const p = screen.getCursorScreenPoint(), wa = screen.getDisplayNearestPoint(p).workArea, b = ww.getBounds();
      const ex = Math.round(Math.max(wa.x, Math.min(wa.x + wa.width - b.width, p.x - 160)));
      t.assert.equal(b.x, ex, 'wheel centred on the mouse again');
      // Size: Large makes the wheel window bigger and zooms the wheel
      await key(t, 'Escape');
      await hoverSector('Size');
      await wjs(t, `document.querySelector('#hex .hx-sector[aria-label="Large"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); 1`);
      await t.until(() => t.settings.get('hexSize') === 'large', { message: 'size saved' });
      t.assert.equal(ww.getBounds().width, 400, 'bigger window');
      t.assert.equal(ww.webContents.getZoomFactor(), 1.25);
      await key(t, 'Escape');
      t.settings.set({ hexMode: 'smooth', hexColor: 'violet', hexSize: 'normal' });
    },
  },
];
