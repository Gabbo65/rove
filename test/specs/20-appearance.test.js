// Appearance: color themes, accent, corners, density and font apply live to the browser UI and Rove's pages.
const { nativeTheme } = require('electron');
const look = require('../../src/main/look');

const RESET = { theme: 'system', lookTheme: 'default', accentColor: '', uiCorners: 'round', uiDensity: 'normal', uiFont: 'system' };
const cssVar = (name) => `getComputedStyle(document.documentElement).getPropertyValue('${name}').trim()`;

module.exports = [
  {
    name: 'color theme + accent change the UI and open Rove pages live; default is unchanged',
    async run(t) {
      t.settings.set(RESET);
      const w = await t.fresh();
      const dark = () => nativeTheme.shouldUseDarkColors;
      t.assert.equal(await t.ui(cssVar('--accent')), look.palette(dark()).accent, 'default accent');
      await t.go('pb://settings/');
      t.settings.set({ lookTheme: 'forest' });
      const forest = () => look.THEMES.forest[dark() ? 'dark' : 'light'];
      await t.until(async () => (await t.ui(cssVar('--strip'))) === forest().strip, { message: 'toolbar recolored' });
      await t.until(async () => (await t.page(cssVar('--page'))) === forest().page, { message: 'open settings page recolored' });
      t.settings.set({ accentColor: '#c239b3' });
      await t.until(async () => (await t.ui(cssVar('--accent'))) === '#c239b3', { message: 'custom accent' });
      t.assert.equal(await t.ui(cssVar('--accent-fg')), '#ffffff', 'readable text on the accent');
      t.settings.set({ theme: 'dark' });
      await t.until(async () => (await t.ui(cssVar('--strip'))) === look.THEMES.forest.dark.strip, { message: 'dark variant' });
      // only one look sheet left after swaps
      await t.until(async () => (await t.ui(`document.querySelectorAll('link[data-look]').length`)) === 1, { message: 'old sheets removed' });
      t.settings.set(RESET);
      await t.until(async () => (await t.ui(cssVar('--accent'))) === look.palette(dark()).accent, { message: 'back to default' });
    },
  },
  {
    name: 'density, corners and font reshape the toolbar; new pages load the look without waiting',
    async run(t) {
      t.settings.set(RESET);
      const w = await t.fresh();
      const h = (sel) => t.ui(`document.querySelector('${sel}').getBoundingClientRect().height`);
      t.assert.equal(await h('#toolbar'), 42);
      t.settings.set({ uiDensity: 'compact', uiCorners: 'square', uiFont: 'mono' });
      await t.until(async () => (await h('#toolbar')) === 36 && (await h('#tabstrip')) === 34, { message: 'compact' })
        .catch(async (e) => { throw new Error(`${e.message}: ${await h('#toolbar')} ${await h('#tabstrip')} ${await t.ui(cssVar('--font'))}`); });
      t.assert.equal(await t.ui(`getComputedStyle(document.getElementById('urlform')).borderRadius`), '4px');
      t.assert.match(await t.ui(cssVar('--font')), /monospace/);
      // the page view follows the taller/shorter toolbar
      const before = 40 + 42 + 32 + 1;
      await t.until(() => w.active.view.getBounds().y === 34 + 36 + 28 + 1, { message: 'page moved up' })
        .catch(async (e) => { throw new Error(`${e.message}: ${JSON.stringify(w.active.view.getBounds())} (normal: ${before}) stage ${await t.ui(`JSON.stringify(document.getElementById('stage').getBoundingClientRect())`)} top ${await h('#top')} favbar ${await h('#favbar')}`); });
      // a page opened now has the look from its first paint (served in look.css)
      const nt = w.newTab(); await t.loaded(nt);
      t.assert.match(await t.page(cssVar('--font'), nt), /monospace/);
      t.settings.set({ uiDensity: 'roomy' });
      await t.until(async () => (await h('#toolbar')) === 48, { message: 'roomy' });
      t.settings.set(RESET);
      await t.until(async () => (await h('#toolbar')) === 42, { message: 'normal again' });
    },
  },
  {
    name: 'Settings → Appearance: theme cards, accent swatches, reset; bad values rejected; InPrivate keeps its colors',
    async run(t) {
      t.settings.set(RESET);
      const w = await t.fresh();
      await t.go('pb://settings/');
      await t.until(async () => (await t.page(`document.querySelectorAll('#look-themes .theme').length`)) === Object.keys(look.THEMES).length, { message: 'theme cards' });
      await t.page(`document.querySelector('#look-themes [data-v=lavender]').click()`);
      await t.until(() => t.settings.get('lookTheme') === 'lavender', { message: 'theme picked' });
      await t.until(async () => t.page(`document.querySelector('#look-themes [data-v=lavender]').classList.contains('on')`), { message: 'card marked' });
      await t.page(`document.querySelector('#look-accents .acc[data-v="#2f8a4c"]').click()`);
      await t.until(() => t.settings.get('accentColor') === '#2f8a4c', { message: 'swatch picked' });
      await t.page(`document.querySelector('#uiDensity [data-v=compact]').click()`);
      await t.until(() => t.settings.get('uiDensity') === 'compact', { message: 'density picked' });
      await t.page(`window.confirm = () => false; document.getElementById('look-reset').click()`);
      await t.sleep(150);
      t.assert.equal(t.settings.get('lookTheme'), 'lavender', 'cancel keeps the look');
      await t.page(`window.confirm = () => true; document.getElementById('look-reset').click()`);
      await t.until(() => t.settings.get('lookTheme') === 'default' && t.settings.get('accentColor') === '' && t.settings.get('uiDensity') === 'normal', { message: 'reset' });
      // validation
      t.settings.set({ accentColor: 'red;}body{display:none', lookTheme: 'nope', uiFont: 'comic', uiDensity: 3 });
      t.assert.equal(t.settings.get('accentColor'), '');
      t.assert.equal(t.settings.get('lookTheme'), 'default');
      t.assert.equal(t.settings.get('uiFont'), 'system');
      // InPrivate keeps its purple, whatever the theme
      t.settings.set({ lookTheme: 'forest', accentColor: '#e0245e' });
      const pw = t.hub.create({ isPrivate: true });
      await t.until(() => pw.uiReady, { message: 'private window' });
      await t.until(async () => (await pw.chrome.webContents.executeJavaScript(cssVar('--accent'))) === '#a98bff', { message: 'private accent kept' });
      pw.base.close();
      t.settings.set(RESET);
    },
  },
];
