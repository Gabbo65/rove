// Passwords & form autofill: encrypted at rest, save prompt, fill only on a real click and only on the same site,
// never in InPrivate, "never for this site", address profiles, and management in Settings.
const passwords = require('../../src/main/passwords');

async function submitLogin(t, user, pass, tab) {
  await t.page(`document.getElementById('user').value = ${JSON.stringify(user)};
    document.getElementById('pass').value = ${JSON.stringify(pass)};
    document.getElementById('login').requestSubmit(); 1`, tab);
}
// Real (trusted) mouse click on the in-page chooser. Waits until it has stopped moving (it fills in its rows
// right after appearing — on slow machines a click at that moment hits nothing), and clicks again if needed.
async function clickChooser(t, tab) {
  const where = () => t.page(`(() => { const h = document.querySelector('pb-autofill');
      if (!h || h.style.display === 'none') return null; const b = h.getBoundingClientRect();
      return b.height > 40 ? [Math.round(b.left + 40), Math.round(b.top + 36), Math.round(b.height)].join(',') : null; })()`, tab);
  for (let attempt = 0; attempt < 3; attempt++) {
    let last = null;
    const spot = await t.until(async () => { const now = await where(); const same = now && now === last; last = now; return same && now; },
      { message: 'chooser visible and settled', interval: 120 });
    const [x, y] = spot.split(',').map(Number);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) tab.wc.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
    const closed = await t.until(async () => !(await where()), { timeout: 1500, message: 'chooser closed' }).then(() => true, () => false);
    if (closed) return;
  }
  throw new Error('chooser never took the click');
}
const clearAll = (t) => t.db().exec('DELETE FROM credentials; DELETE FROM password_never; DELETE FROM form_profiles;');

module.exports = [
  {
    name: 'stored encrypted (Keychain key), never as plain text; update + known checks',
    async run(t) {
      clearAll(t);
      t.assert.ok(await passwords.available(), 'encryption available');
      t.assert.equal(await passwords.save({ origin: 'https://site.example', username: 'ana', password: 'S3cret-Plain!' }), 'saved');
      const raw = t.db().prepare('SELECT password FROM credentials').get().password;
      t.assert.ok(!Buffer.from(raw).toString('latin1').includes('S3cret-Plain!'), 'no plain text in the database');
      const file = require('fs').readFileSync(require('path').join(t.app.getPath('userData'), 'browser.db'));
      t.assert.ok(!file.includes(Buffer.from('S3cret-Plain!')), 'no plain text in the db file');
      t.assert.equal(await passwords.password(passwords.list()[0].id), 'S3cret-Plain!');
      t.assert.equal(await passwords.password(passwords.list()[0].id, { origin: 'https://evil.example' }), null, 'wrong site gets nothing');
      t.assert.equal(await passwords.save({ origin: 'https://site.example', username: 'ana', password: 'S3cret-Plain!' }), 'unchanged');
      t.assert.equal(await passwords.save({ origin: 'https://site.example', username: 'ana', password: 'new' }), 'updated');
      t.assert.ok(await passwords.isKnown({ origin: 'https://site.example', username: 'ana', password: 'new' }));
    },
  },
  {
    name: 'login submit → "Save password?" → saved; next visit: click field → pick account → filled',
    async run(t) {
      clearAll(t);
      const w = await t.fresh();
      const tab = await t.go(t.url('/form'));
      await submitLogin(t, 'ana@example.com', 'hunter2!', tab);
      await t.until(async () => !(await t.ui(`document.getElementById('save-pop').hidden`)), { message: 'save prompt shown' });
      t.assert.equal(await t.ui(`document.getElementById('sp-user').value`), 'ana@example.com');
      t.assert.equal(await t.ui(`document.getElementById('sp-pass').value`), '••••••••', 'UI never gets the password');
      await t.ui(`document.getElementById('sp-save').click()`);
      await t.until(() => passwords.list().length === 1, { message: 'saved' });
      t.assert.equal(passwords.list()[0].origin, new URL(t.base).origin);
      // fill on the next visit
      await t.go(t.url('/form'));
      t.assert.equal(await t.page(`document.getElementById('pass').value`), '', 'nothing filled before you choose');
      await t.page(`document.getElementById('user').focus(); 1`);
      await clickChooser(t, tab);
      await t.until(async () => (await t.page(`document.getElementById('pass').value`)) === 'hunter2!', { message: 'password filled' });
      t.assert.equal(await t.page(`document.getElementById('user').value`), 'ana@example.com');
      // submitting what we filled doesn't ask again
      await t.page(`document.getElementById('login').requestSubmit(); 1`);
      await t.sleep(500);
      t.assert.ok(await t.ui(`document.getElementById('save-pop').hidden`));
    },
  },
  {
    name: 'other sites get nothing; synthetic (script) clicks cannot pick an account',
    async run(t) {
      clearAll(t);
      await passwords.save({ origin: new URL(t.base).origin, username: 'ana', password: 'pw-for-127' });
      await t.fresh();
      // same server, different origin (localhost vs 127.0.0.1)
      const other = t.base.replace('127.0.0.1', 'localhost');
      const tab = await t.go(other + '/form');
      await t.page(`document.getElementById('user').focus(); 1`);
      await t.sleep(400);
      t.assert.equal(await t.page(`!!document.querySelector('pb-autofill') && document.querySelector('pb-autofill').style.display !== 'none'`), false, 'no chooser on another site');
      // right site, but the page tries to click the chooser itself
      await t.go(t.url('/form'));
      await t.page(`document.getElementById('user').focus(); 1`);
      await t.until(() => t.page(`!!document.querySelector('pb-autofill') && document.querySelector('pb-autofill').style.display === 'block'`), { message: 'chooser' });
      await t.page(`(() => { const h = document.querySelector('pb-autofill'); const b = h.getBoundingClientRect();
        document.elementFromPoint(b.left + 40, b.top + 36)?.click(); h.dispatchEvent(new MouseEvent('click', { bubbles: true })); })(); 1`);
      await t.sleep(400);
      t.assert.equal(await t.page(`document.getElementById('pass').value`), '', 'script clicks do nothing');
      t.assert.equal(await t.page('typeof (window.pb && window.pb.call)'), 'undefined', 'web pages have no browser API');
    },
  },
  {
    name: '"Never for this site" stops prompts; InPrivate windows never offer to save',
    async run(t) {
      clearAll(t);
      const w = await t.fresh();
      let tab = await t.go(t.url('/form'));
      await submitLogin(t, 'bob', 'pw1', tab);
      await t.until(async () => !(await t.ui(`document.getElementById('save-pop').hidden`)), { message: 'prompt' });
      await t.ui(`document.getElementById('sp-never').click()`);
      await t.until(() => passwords.never.list().length === 1, { message: 'never saved' });
      tab = await t.go(t.url('/form'));
      await submitLogin(t, 'bob', 'pw2', tab);
      await t.sleep(500);
      t.assert.ok(await t.ui(`document.getElementById('save-pop').hidden`), 'no prompt after Never');
      passwords.never.remove(passwords.never.list()[0]);
      const p = t.hub.create({ isPrivate: true });
      await t.until(() => p.uiReady && p.active?.wc, { message: 'private window' });
      p.navigate(t.url('/form'));
      await t.loaded(p.active); await t.until(() => p.active.title === 'Login', { message: 'loaded in private' });
      await submitLogin(t, 'carl', 'pw3', p.active);
      await t.sleep(600);
      t.assert.ok(await t.ui(`document.getElementById('save-pop').hidden`, p), 'no prompt in InPrivate');
      t.assert.equal(passwords.list().length, 0);
      p.base.close();
    },
  },
  {
    name: 'addresses: submit → "Save this address?" → saved encrypted → filled on another form',
    async run(t) {
      clearAll(t);
      await t.fresh();
      let tab = await t.go(t.url('/address'));
      await t.page(`for (const [id, v] of Object.entries({ name: 'Ana Rossi', email: 'ana@example.com', tel: '+39 333 1234567', street: 'Via Roma 1', city: 'Milano', zip: '20100' }))
        document.getElementById(id).value = v; document.getElementById('addr').requestSubmit(); 1`, tab);
      await t.until(async () => (await t.ui(`document.getElementById('sp-title').textContent`)) === 'Save this address?', { message: 'address prompt' });
      await t.ui(`document.getElementById('sp-save').click()`);
      await t.until(async () => (await passwords.profiles()).length === 1, { message: 'profile saved' });
      const raw = t.db().prepare('SELECT data FROM form_profiles').get().data;
      t.assert.ok(!Buffer.from(raw).toString('latin1').includes('Via Roma'), 'encrypted');
      tab = await t.go(t.url('/address'));
      await t.page(`document.getElementById('name').focus(); 1`, tab);
      await clickChooser(t, tab);
      await t.until(async () => (await t.page(`document.getElementById('city').value`, tab)) === 'Milano', { message: 'address filled' });
      t.assert.equal(await t.page(`document.getElementById('email').value`, tab), 'ana@example.com');
      t.assert.equal(await t.page(`document.getElementById('zip').value`, tab), '20100');
    },
  },
  {
    name: 'Settings → Passwords: list, reveal (after unlock), delete',
    async run(t) {
      clearAll(t);
      await passwords.save({ origin: 'https://site.example', username: 'ana', password: 'visible-after-unlock' });
      const w = await t.fresh();
      await t.go('pb://settings/#passwords');
      await t.until(async () => (await t.page(`document.querySelectorAll('#pw-list .item').length`)) === 1, { message: 'listed' });
      t.assert.equal(await t.page(`document.querySelector('#pw-list .secret').textContent`), '••••••••');
      await t.page(`document.querySelector('#pw-list .reveal').click()`);
      await t.until(async () => (await t.page(`document.querySelector('#pw-list .secret').textContent`)) === 'visible-after-unlock', { message: 'revealed' });
      process.env.PB_TEST_AUTH = 'deny';
      const res = await t.hub.PAGE_API.settings.revealPassword({ win: { base: w.base } }, passwords.list()[0].id);
      t.assert.equal(res, null, 'no unlock → no password');
      delete process.env.PB_TEST_AUTH;
      await t.page(`window.confirm = () => true; document.querySelector('#pw-list .del').click()`);
      await t.until(() => passwords.list().length === 0, { message: 'deleted' });
      await t.until(async () => (await t.page(`document.querySelectorAll('#pw-list .item').length`)) === 0, { message: 'list updated' });
    },
  },
];
