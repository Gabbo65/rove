// Address-bar suggestions: local matches + inline completion + engine suggestions; keyboard; switch to tab.
const suggest = require('../../src/main/suggest');
const history = require('../../src/main/history');
const favorites = require('../../src/main/favorites');

async function type(t, text) {
  await t.ui(`{ const i = document.getElementById('url'); i.focus(); i.value = ${JSON.stringify(text)};
    i.setSelectionRange(i.value.length, i.value.length); i.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: 'x' })); }`);
}
const rows = (t) => t.ui(`[...document.querySelectorAll('#suggest .sg-row')].map(r => r.textContent).join('\\n')`);
const key = (t, k, extra = '') => t.ui(`document.getElementById('url').dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true, cancelable: true ${extra} }))`);

module.exports = [
  {
    name: 'local results: typed text first, history ranked by use, favorites, inline completion',
    async run(t) {
      history.clear();
      t.db().exec('DELETE FROM favorites');
      const now = Date.now();
      history.importEntries([
        ...Array.from({ length: 6 }, (_, i) => ({ url: 'https://www.youtube.com/', title: 'YouTube', t: now - i * 1000 })),
        { url: 'https://www.yourdictionary.com/', title: 'Your Dictionary', t: now - 5000 },
        { url: 'https://example.com/youth', title: 'Youth page', t: now - 10 * 864e5 },
      ]);
      favorites.add({ url: 'https://youngplace.example/', title: 'Young Fav' });
      const r = suggest.local('you');
      t.assert.equal(r.inline.completion, 'tube.com', 'you → youtube.com');
      t.assert.equal(r.items[0].url, 'https://www.youtube.com/');
      t.assert.ok(r.items.some((x) => x.type === 'favorite' && x.title === 'Young Fav'));
      t.assert.ok(r.items.findIndex((x) => x.url === 'https://www.yourdictionary.com/') > 0);
      t.assert.equal(suggest.local('how to cook').items[0].type, 'search');
      t.assert.equal(suggest.local('example.org/path').items[0].type, 'url');
      t.assert.equal(suggest.inlineFor('you tube', [{ url: 'https://youtube.com/' }]), null, 'no inline for multi-word text');
    },
  },
  {
    name: 'engine suggestions are fetched (and can be turned off); URLs are never sent',
    async run(t) {
      t.settings.set({ searchEngine: 'custom', customSearch: { name: 'Local', url: t.url('/p1?q=%s'), suggestUrl: t.url('/suggest?q=%s') } });
      const list = await suggest.remote('cats');
      t.assert.deepEqual(list.map((x) => x.text), ['cats one', 'cats two', 'cats three']);
      t.assert.deepEqual(await suggest.remote('example.com'), [], 'address-like text is not sent');
      t.settings.set({ searchSuggestions: false });
      t.assert.deepEqual(await suggest.remote('dogs'), []);
      t.settings.set({ searchSuggestions: true, searchEngine: 'google' });
    },
  },
  {
    name: 'UI: dropdown, inline completion, arrows, Enter goes, Esc restores, switch to tab',
    async run(t) {
      history.clear();
      t.db().exec('DELETE FROM favorites');
      t.settings.set({ searchEngine: 'custom', customSearch: { name: 'Local', url: t.url('/p3?q=%s'), suggestUrl: t.url('/suggest?q=%s') } });
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      await t.go(t.url('/p2'));
      const other = w.newTab(t.url('/long')); await t.loaded(other);
      w.activate(w.tabs[0]);
      await type(t, '127.0.0.1');
      await t.until(async () => /p2|p1|Page/.test(await rows(t)), { message: 'dropdown rows' });
      t.assert.ok(w.overlay, 'dropdown lifts the UI over the page');
      const val = await t.ui(`[document.getElementById('url').value, document.getElementById('url').selectionStart]`);
      t.assert.ok(val[0].startsWith('127.0.0.1:'), `inline completed (${val[0]})`);
      // switch to the open "Long Text" tab via its suggestion
      await type(t, 'long');
      await t.until(async () => /Switch to tab/.test(await rows(t)), { message: 'tab suggestion' });
      const idx = await t.ui(`[...document.querySelectorAll('#suggest .sg-row')].findIndex(r => r.textContent.includes('Switch to tab'))`);
      for (let i = 0; i <= idx; i++) await key(t, 'ArrowDown');
      await key(t, 'Enter');
      await t.until(() => w.active === other, { message: 'switched tab' });
      await t.until(() => !w.overlay, { message: 'dropdown closed' });
      // engine suggestions appear; Esc restores the typed text; Enter on a suggestion searches
      w.activate(w.tabs[0]);
      await type(t, 'cats');
      await t.until(async () => /cats two/.test(await rows(t)), { message: 'engine suggestions in UI' });
      await key(t, 'ArrowDown'); await key(t, 'ArrowDown');
      t.assert.notEqual(await t.ui(`document.getElementById('url').value`), 'cats');
      await key(t, 'Escape');
      t.assert.equal(await t.ui(`document.getElementById('url').value`), 'cats');
      const n = await t.ui(`[...document.querySelectorAll('#suggest .sg-row')].findIndex(r => r.textContent.startsWith('cats two'))`);
      for (let i = 0; i <= n; i++) await key(t, 'ArrowDown');
      await key(t, 'Enter');
      await t.until(() => w.active.url.includes('/p3?q=cats%20two'), { message: 'searched the suggestion' });
      t.settings.set({ searchEngine: 'google' });
    },
  },
];
