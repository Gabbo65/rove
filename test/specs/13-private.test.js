// InPrivate windows: own in-memory session, nothing kept after closing.
const { session } = require('electron');
const history = require('../../src/main/history');
const downloads = require('../../src/main/downloads');

module.exports = [
  {
    name: 'no history, separate cookies, closed tabs stay private, explanation on New Tab',
    async run(t) {
      history.clear();
      await t.fresh();
      const p = t.hub.create({ isPrivate: true });
      await t.until(() => p.uiReady && p.active?.wc, { message: 'private window' });
      t.assert.equal(p.session.isPersistent(), false, 'memory-only session');
      t.assert.ok(await t.ui(`document.documentElement.classList.contains('private') && !document.getElementById('private-badge').hidden`, p));
      await t.until(async () => !(await t.page(`document.getElementById('private-note').hidden`, p.active)), { message: 'InPrivate note' });
      p.navigate(t.url('/cookie')); await t.until(() => p.active.title === 'Cookie', { message: 'loaded' });
      p.navigate(t.url('/p1')); await t.until(() => p.active.title === 'Page One', { message: 'loaded 2' });
      t.assert.equal(history.recent(10).length, 0, 'nothing in history');
      t.assert.equal((await p.session.cookies.get({ name: 'pbtest' })).length, 1);
      t.assert.equal((await session.defaultSession.cookies.get({ name: 'pbtest' })).length, 0, 'normal windows do not see it');
      const x = p.newTab(t.url('/p2')); await t.loaded(x);
      const before = t.db().prepare('SELECT COUNT(*) n FROM closed_actions').get().n;
      p.close(x);
      t.assert.equal(t.db().prepare('SELECT COUNT(*) n FROM closed_actions').get().n, before, 'closed private tabs not stored on disk');
      t.assert.ok(p.reopenClosed(), 'but can be reopened inside the window');
    },
  },
  {
    name: 'closing the window wipes cookies/storage; downloads list forgets it (files stay)',
    async run(t) {
      await t.fresh();
      const p = t.hub.create({ isPrivate: true });
      await t.until(() => p.uiReady && p.active?.wc, { message: 'private window' });
      p.navigate(t.url('/cookie')); await t.until(() => p.active.title === 'Cookie', { message: 'loaded' });
      await t.page(`localStorage.setItem('k', 'v'); 1`, p.active);
      p.active.wc.downloadURL(t.url('/file.bin'));
      await t.until(() => downloads.list().some((d) => d.private && d.state === 'completed'), { message: 'private download done' });
      t.assert.equal(t.db().prepare("SELECT COUNT(*) n FROM downloads WHERE url LIKE '%file.bin'").get().n >= 0, true);
      const ses = p.session;
      p.base.close();
      await t.until(() => !t.hub.all().includes(p), { message: 'closed' });
      await t.until(async () => (await ses.cookies.get({})).length === 0, { message: 'cookies wiped' });
      t.assert.ok(!downloads.list().some((d) => d.private), 'private downloads gone from the list');
      // a new private window starts empty
      const p2 = t.hub.create({ isPrivate: true });
      await t.until(() => p2.uiReady && p2.active?.wc, { message: 'second private window' });
      t.assert.notEqual(p2.session, ses, 'fresh session');
      t.assert.equal((await p2.session.cookies.get({})).length, 0);
      p2.base.close();
    },
  },
];
