// Engine updates: version decision, check against a (local) registry, toolbar button.
const updates = require('../../src/main/updates');

module.exports = [
  {
    name: 'version decision: up to date / update available / unsupported (3+ majors behind)',
    async run(t) {
      t.assert.equal(updates.evaluate('45.2.3', '45.2.3'), 'up-to-date');
      t.assert.equal(updates.evaluate('45.2.3', '45.1.0'), 'up-to-date');
      t.assert.equal(updates.evaluate('45.2.3', '45.2.4'), 'update-available');
      t.assert.equal(updates.evaluate('45.2.3', '47.0.0'), 'update-available');
      t.assert.equal(updates.evaluate('45.2.3', '48.0.0'), 'unsupported');
      t.assert.equal(updates.evaluate('45.2.3', null), 'unknown');
    },
  },
  {
    name: 'check reads the registry; the toolbar shows Update (red when unsupported); errors are kept, not thrown',
    async run(t) {
      await t.fresh();
      const cur = process.versions.electron;
      const major = Number(cur.split('.')[0]);
      process.env.PB_UPDATE_URL = t.url('/npm-latest?v=' + cur);
      t.assert.equal((await updates.check()).status, 'up-to-date');
      await t.until(async () => t.ui(`document.getElementById('update-btn').hidden`), { message: 'no button when current' });
      process.env.PB_UPDATE_URL = t.url(`/npm-latest?v=${major}.99.0`);
      t.assert.equal((await updates.check()).status, 'update-available');
      await t.until(async () => !(await t.ui(`document.getElementById('update-btn').hidden`)), { message: 'button shown' });
      process.env.PB_UPDATE_URL = t.url(`/npm-latest?v=${major + 3}.0.0`);
      t.assert.equal((await updates.check()).status, 'unsupported');
      await t.until(async () => t.ui(`document.getElementById('update-btn').classList.contains('urgent')`), { message: 'red when unsupported' });
      process.env.PB_UPDATE_URL = 'http://127.0.0.1:59999/nothing';
      const s = await updates.check();
      t.assert.ok(s.error, 'error recorded');
      t.assert.equal(s.latest, `${major + 3}.0.0`, 'last known version kept');
      process.env.PB_UPDATE_URL = t.url('/npm-latest?v=' + cur); // leave it "up to date" so no update button leaks into later tests
      await updates.check();
      delete process.env.PB_UPDATE_URL;
    },
  },
  {
    name: 'update script and source folder are found',
    async run(t) {
      const fs = require('fs'), path = require('path');
      const dir = updates.sourceDir();
      t.assert.ok(dir && fs.existsSync(path.join(dir, 'scripts', 'update-engine.sh')));
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      t.assert.match(pkg.scripts['update-engine'], /update-engine\.sh/);
      t.assert.match(fs.readFileSync(path.join(dir, 'scripts', 'update-engine.sh'), 'utf8'), /npm test\n[\s\S]*npm run install-app/);
    },
  },
];
