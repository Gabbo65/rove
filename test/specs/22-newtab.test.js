// New Tab page customization: background (gradient / your picture, darkened), clock + greeting, search box and favorites on/off.
const fs = require('fs');
const path = require('path');
const os = require('os');
const newtabBg = require('../../src/main/newtab-bg');

const RESET = { ntBackground: 'plain', ntGradient: 'rove', ntImage: 0, ntDim: 25, ntShowSearch: true, ntShowFavorites: true, ntClock: 'off' };
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

module.exports = [
  {
    name: 'gradient + darkening, clock with greeting, search box and favorites can be hidden — live',
    async run(t) {
      newtabBg.clear(); t.settings.set(RESET);
      const w = await t.fresh();
      const nt = w.active;
      const q = (code) => t.page(code, nt);
      await t.until(async () => q(`document.getElementById('bg').hidden && document.getElementById('clockbox').hidden && !document.getElementById('f').hidden`), { message: 'default look' });
      await t.until(async () => (await t.ui(`document.activeElement.id`)) === 'url' && w.chrome.webContents.isFocused(), { message: 'a new window focuses the address bar' });
      t.settings.set({ ntBackground: 'gradient', ntGradient: 'ocean', ntDim: 40, ntClock: 'greeting' });
      await t.until(async () => q(`{ const b = document.getElementById('bg'); !b.hidden && b.className === 'g-ocean' && document.body.classList.contains('has-bg') }`), { message: 'gradient' });
      t.assert.equal(await q(`getComputedStyle(document.getElementById('bg')).getPropertyValue('--dim').trim()`), '0.4');
      t.assert.match(await q(`document.getElementById('clock').textContent`), /\d/);
      t.assert.match(await q(`document.getElementById('greet').textContent`), /^Good (night|morning|afternoon|evening)$/);
      t.settings.set({ ntShowSearch: false, ntShowFavorites: false, ntClock: 'clock' });
      await t.until(async () => q(`document.getElementById('f').hidden && document.getElementById('tiles').hidden && document.getElementById('greet').hidden && !document.getElementById('clockbox').hidden`), { message: 'hidden parts' });
      // the address bar still gets the focus with the search box hidden
      t.assert.equal(await t.ui(`document.activeElement.id`), 'url');
      t.settings.set(RESET);
      await t.until(async () => q(`document.getElementById('bg').hidden && !document.getElementById('f').hidden`), { message: 'reset' });
    },
  },
  {
    name: 'your own picture: copied in, shown, bad files refused, removable',
    async run(t) {
      newtabBg.clear(); t.settings.set(RESET);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rove-bg-'));
      const png = path.join(dir, 'beach.png'); fs.writeFileSync(png, PNG_1PX);
      const txt = path.join(dir, 'notes.txt'); fs.writeFileSync(txt, 'hi');
      t.assert.match(newtabBg.useFile(txt), /PNG, JPEG/);
      t.assert.match(newtabBg.useFile(path.join(dir, 'missing.png')), /can’t be read/);
      t.assert.equal(newtabBg.useFile(png), null);
      t.assert.equal(t.settings.get('ntBackground'), 'image');
      t.assert.ok(t.settings.get('ntImage') > 0);
      fs.rmSync(png); // Rove kept its own copy
      const w = await t.fresh();
      const ok = await t.page(`new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth === 1); i.onerror = () => res(false);
        i.src = 'pb://shared/newtab-bg?v=' + Date.now(); })`, w.active);
      t.assert.ok(ok, 'picture served to the page');
      t.assert.match(await t.page(`document.getElementById('bg').style.backgroundImage`, w.active), /pb:\/\/shared\/newtab-bg\?v=\d+/);
      newtabBg.clear();
      t.assert.equal(t.settings.get('ntBackground'), 'plain');
      t.assert.equal(newtabBg.current(), null, 'copy deleted');
      fs.rmSync(dir, { recursive: true, force: true });
    },
  },
  {
    name: 'Customize button opens Settings → Appearance; its controls work',
    async run(t) {
      newtabBg.clear(); t.settings.set(RESET);
      const w = await t.fresh();
      await t.page(`document.getElementById('customize').click()`, w.active);
      await t.until(() => w.active.url === 'pb://settings/#appearance', { message: `settings opened (${w.active.url})` });
      await t.loaded(w.active);
      await t.until(async () => t.page(`!!document.querySelector('#ntBackground [data-v=gradient]')`), { message: 'section' });
      // Appearance rules for the toolbar must not touch page elements with the same id (section#newtab)
      for (const uiDensity of ['compact', 'normal', 'roomy']) {
        t.settings.set({ uiDensity });
        await t.sleep(150);
        const h = await t.page(`document.getElementById('newtab').getBoundingClientRect().height`);
        t.assert.ok(h > 200, `New tab page section keeps its height with ${uiDensity} toolbar (${h}px)`);
      }
      t.settings.set({ uiDensity: 'normal' });
      await t.page(`document.querySelector('#ntBackground [data-v=gradient]').click()`);
      await t.until(() => t.settings.get('ntBackground') === 'gradient', { message: 'gradient' });
      await t.until(async () => t.page(`!document.getElementById('nt-grad-row').hidden && document.getElementById('nt-img-row').hidden`), { message: 'gradient row shown' });
      await t.page(`document.querySelector('#nt-grads [data-v=ember]').click()`);
      await t.until(() => t.settings.get('ntGradient') === 'ember', { message: 'ember' });
      await t.page(`document.querySelector('#ntClock [data-v=clock]').click()`);
      await t.until(() => t.settings.get('ntClock') === 'clock', { message: 'clock' });
      await t.page(`document.querySelector('[data-setting=ntShowFavorites]').click()`);
      await t.until(() => t.settings.get('ntShowFavorites') === false, { message: 'favorites off' });
      await t.page(`{ const r = document.getElementById('ntDim'); r.value = '50'; r.dispatchEvent(new Event('input')); }`);
      await t.until(() => t.settings.get('ntDim') === 50, { message: 'dim' });
      t.settings.set(RESET);
    },
  },
];
