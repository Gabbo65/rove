// Glass: Docked Glass toolbar (system blur behind a see-through toolbar) and glass cards on Rove's pages.
const look = require('../../src/main/look');

const RESET = { toolbarStyle: 'solid', pagesStyle: 'solid', ntBackground: 'plain', theme: 'system', lookTheme: 'default', accentColor: '' };
const bg = (sel) => `getComputedStyle(document.querySelector('${sel}')).backgroundColor`;
const blur = (sel) => `getComputedStyle(document.querySelector('${sel}')).backdropFilter`;

module.exports = [
  {
    name: 'Docked Glass: the window gets the system blur and the toolbar turns see-through; InPrivate and Solid stay solid',
    async run(t) {
      t.settings.set(RESET);
      const w = await t.fresh();
      t.assert.equal(w.glass, false);
      t.assert.doesNotMatch(await t.ui(bg('#top')), /0\.\d+\)$|\/ 0\.\d/, 'solid toolbar by default');
      t.settings.set({ toolbarStyle: 'docked' });
      if (!look.glassSupported()) { // Linux / older Windows: no blur behind windows → stays solid
        await t.sleep(300);
        t.assert.equal(w.glass, false);
        t.settings.set(RESET);
        return;
      }
      await t.until(() => w.glass === true, { message: 'native blur on' });
      await t.until(async () => /\/ 0\.\d|, 0\.\d+\)$/.test(await t.ui(bg('#top'))), { message: `see-through toolbar (${await t.ui(bg('#top'))})` });
      t.assert.match(await t.ui(bg('#tabstrip')), /rgba\(0, 0, 0, 0\.(1|04)\)/, 'tab strip a shade darker (kept light: heavy tints hid the glass)');
      // + Pages Glass: Rove's own pages are see-through too (the system blur shows), and add no CSS blur of their own
      t.settings.set({ pagesStyle: 'glass' });
      const nt = w.active;
      await t.until(async () => /\/ 0\.[0-4]\d*\)$|, 0(\.[0-4]\d*)?\)$/.test(await t.page(`getComputedStyle(document.body).backgroundColor`, nt)), { message: 'see-through New Tab page' });
      t.assert.equal(await t.page(blur('#f'), nt), 'none', 'no CSS blur over the system blur (it smears and leaves ghosts)');
      t.assert.deepEqual(nt.view.getBackgroundColor?.() ?? '#00000000', '#00000000');
      t.settings.set({ pagesStyle: 'solid' });
      // InPrivate windows keep their solid purple
      const pw = t.hub.create({ isPrivate: true });
      await t.until(() => pw.uiReady, { message: 'private window' });
      t.assert.equal(pw.glass, false, 'no glass for InPrivate');
      t.assert.equal(await pw.chrome.webContents.executeJavaScript(`getComputedStyle(document.getElementById('top')).backgroundColor`), 'rgb(42, 31, 61)');
      pw.base.close();
      t.settings.set({ toolbarStyle: 'solid' });
      await t.until(() => w.glass === false, { message: 'native blur off' });
      await t.until(async () => (await t.ui(`getComputedStyle(document.getElementById('tabstrip')).backgroundColor`)) !== 'rgba(0, 0, 0, 0.2)'
        && !/\/ 0\.\d|, 0\.\d+\)$/.test(await t.ui(bg('#top'))), { message: 'solid again' });
      t.settings.set(RESET);
    },
  },
  {
    name: 'Pages Glass: frosted search box, clock, tiles on New Tab; glass cards in Settings and History',
    async run(t) {
      t.settings.set({ ...RESET, ntClock: 'clock' });
      const w = await t.fresh();
      const nt = w.active;
      t.assert.equal(await t.page(blur('#f'), nt), 'none');
      t.settings.set({ pagesStyle: 'glass' });
      // mostly see-through (the Transparency slider mixes in a little of the theme color)
      const transparent = async (tab) => /\/ 0\.[0-4]\d*\)$|, 0(\.[0-4]\d*)?\)$/.test(await t.page(`getComputedStyle(document.body).backgroundColor`, tab));
      if (look.glassSupported()) {
        // with a SOLID toolbar too: the window gets the system blur and Rove's pages are see-through
        await t.until(async () => w.glass === true && (await transparent(nt)), { message: 'see-through New Tab, solid toolbar' });
        t.assert.doesNotMatch(await t.ui(bg('#top')), /\/ 0\.\d|, 0\.\d+\)$/, 'toolbar stays solid');
        await t.go('pb://settings/');
        await t.until(async () => transparent(), { message: 'see-through settings' });
        t.assert.equal(await t.page(`getComputedStyle(document.querySelector('.tb-row')).backgroundColor`), 'rgba(0, 0, 0, 0)', 'toolbar-button rows are glass too');
        await t.go('pb://history/');
        await t.until(async () => transparent(), { message: 'see-through history' });
      } else {
        await t.until(async () => /blur/.test(await t.page(blur('#f'), nt)), { message: 'glass search box (CSS blur fallback)' });
        await t.go('pb://history/');
        await t.until(async () => /blur/.test(await t.page(blur('.search'))), { message: 'glass history' });
      }
      t.settings.set({ pagesStyle: 'solid' });
      await t.until(async () => !(await transparent()) && w.glass === false, { message: 'solid again' });
      t.settings.set({ ...RESET, ntClock: 'off' });
    },
  },
  {
    name: 'Settings → Appearance: Toolbar Solid / Docked Glass (Floating Glass not yet), Pages Solid / Glass, reset',
    async run(t) {
      t.settings.set(RESET);
      await t.fresh();
      await t.go('pb://settings/#appearance');
      await t.until(async () => t.page(`!!document.querySelector('#toolbarStyle [data-v=docked]')`), { message: 'controls' });
      t.assert.ok(await t.page(`document.querySelector('#toolbarStyle [data-v=floating]').disabled`), 'floating: coming soon');
      t.assert.equal(await t.page(`document.querySelector('#toolbarStyle [data-v=docked]').disabled`), !look.glassSupported());
      if (look.glassSupported()) {
        await t.page(`document.querySelector('#toolbarStyle [data-v=docked]').click()`);
        await t.until(() => t.settings.get('toolbarStyle') === 'docked', { message: 'docked' });
      }
      await t.page(`document.querySelector('#pagesStyle [data-v=glass]').click()`);
      await t.until(() => t.settings.get('pagesStyle') === 'glass', { message: 'pages glass' });
      t.settings.set({ toolbarStyle: 'floating' });
      t.assert.notEqual(t.settings.get('toolbarStyle'), 'floating', 'not available yet');
      await t.page(`window.confirm = () => true; document.getElementById('look-reset').click()`);
      await t.until(() => t.settings.get('toolbarStyle') === 'solid' && t.settings.get('pagesStyle') === 'solid', { message: 'reset clears glass' });
      t.settings.set(RESET);
    },
  },
  {
    name: 'Transparency slider: shows only with a glass option, changes how much shows through',
    async run(t) {
      t.settings.set({ ...RESET, glassLevel: 85 });
      const w = await t.fresh();
      await t.go('pb://settings/#appearance');
      await t.until(async () => t.page(`document.getElementById('glass-level-row').hidden`), { message: 'hidden while all solid' });
      t.settings.set({ pagesStyle: 'glass' });
      await t.until(async () => t.page(`!document.getElementById('glass-level-row').hidden`), { message: 'shown with glass' });
      const o = () => t.page(`getComputedStyle(document.documentElement).getPropertyValue('--glass-o').trim()`);
      await t.until(async () => (await o()) === '15%', { message: '85% transparency' });
      await t.page(`{ const r = document.getElementById('glassLevel'); r.value = '30'; r.dispatchEvent(new Event('input')); }`);
      await t.until(() => t.settings.get('glassLevel') === 30, { message: 'slider saved' });
      await t.until(async () => (await o()) === '70%', { message: 'less see-through' });
      t.settings.set({ glassLevel: 150 });
      t.assert.equal(t.settings.get('glassLevel'), 30, 'out of range refused');
      t.settings.set({ ...RESET, glassLevel: 85 });
    },
  },
  {
    name: 'Blur off (macOS): clear glass — no system blur, window still transparent; switch hidden elsewhere',
    async run(t) {
      t.settings.set({ ...RESET, glassBlur: true });
      const w = await t.fresh();
      t.settings.set({ toolbarStyle: 'docked', pagesStyle: 'glass' });
      await t.go('pb://settings/#appearance');
      const mac = process.platform === 'darwin';
      await t.until(async () => (await t.page(`!document.getElementById('glass-blur-row').hidden`)) === mac, { message: 'Blur row only on macOS' });
      if (!mac) { t.settings.set(RESET); return; }
      await t.until(() => w.glass && w.blur === true, { message: 'blur on' });
      await t.page(`document.querySelector('[data-setting=glassBlur]').click()`);
      await t.until(() => t.settings.get('glassBlur') === false && w.glass && w.blur === false, { message: 'clear glass' });
      t.assert.equal(w.base.getBackgroundColor().slice(-2).toLowerCase() === '00' || w.base.getBackgroundColor() === '#00000000', true, 'window background transparent');
      t.settings.set({ ...RESET, glassBlur: true });
      await t.until(() => w.glass === false, { message: 'solid again' });
    },
  },
];
