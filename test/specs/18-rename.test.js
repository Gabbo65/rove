// Rename "Personal Browser" → Rove: the old data folder is copied and saved passwords / addresses are
// unlocked by a helper process (old name) and re-locked with Rove's key.
const fs = require('fs');
const path = require('path');
const rename = require('../../src/main/rename');
const passwords = require('../../src/main/passwords');

module.exports = [
  {
    name: 'old folder copied (no locks/caches), secrets re-locked through the helper, flag cleared; new data never overwritten',
    timeout: 60000,
    async run(t) {
      t.db().exec('DELETE FROM credentials; DELETE FROM form_profiles;');
      await passwords.save({ origin: 'https://moved.example', username: 'ana', password: 'Moved-Secret-1' });
      await passwords.saveProfile?.({ name: 'Ana', city: 'Milano' });
      t.db().exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const oldDir = path.join(t.tmp, 'old-personal-browser'), newDir = path.join(t.tmp, 'new-rove');
      fs.mkdirSync(path.join(oldDir, 'GPUCache'), { recursive: true });
      fs.copyFileSync(path.join(require('electron').app.getPath('userData'), 'browser.db'), path.join(oldDir, 'browser.db'));
      fs.writeFileSync(path.join(oldDir, 'remote.json'), '{"keep":true}');
      // Windows keeps the encryption key in the profile's "Local State" — it moves with the folder.
      try { fs.copyFileSync(path.join(require('electron').app.getPath('userData'), 'Local State'), path.join(oldDir, 'Local State')); } catch {}
      fs.writeFileSync(path.join(oldDir, 'SingletonLock'), 'x');

      t.assert.equal(rename.copyIfNeeded(newDir, oldDir), true);
      t.assert.ok(fs.existsSync(path.join(newDir, 'remote.json')), 'phone remote key moved');
      t.assert.ok(!fs.existsSync(path.join(newDir, 'SingletonLock')) && !fs.existsSync(path.join(newDir, 'GPUCache')), 'locks and caches skipped');
      t.assert.equal(rename.copyIfNeeded(newDir, oldDir), false, 'never copies over existing data');

      const { DatabaseSync } = require('node:sqlite');
      const conn = new DatabaseSync(path.join(newDir, 'browser.db'));
      // Under test the "old" name is the current one, so the helper can unlock with the same key.
      process.env.PB_OLD_NAME = require('electron').app.getName();
      try {
        const r = await rename.rekeyIfPending(conn, newDir);
        t.assert.equal(r.lost, 0, r.error);
        t.assert.ok(r.moved >= 1, 'secrets re-locked');
      } finally { delete process.env.PB_OLD_NAME; }
      const after = conn.prepare('SELECT password FROM credentials').get().password;
      t.assert.ok(!Buffer.from(after).toString('latin1').includes('Moved-Secret-1'), 'still encrypted');
      const { safeStorage } = require('electron');
      t.assert.equal((await safeStorage.decryptStringAsync(Buffer.from(after))).result, 'Moved-Secret-1');
      t.assert.ok(!fs.existsSync(path.join(newDir, '.rekey-pending')), 'done only once');
      t.assert.equal(await rename.rekeyIfPending(conn, newDir), null);
      conn.close();
    },
  },
  {
    name: 'if the helper can’t unlock, unreadable copies are dropped (old ones stay in the old folder)',
    async run(t) {
      const dir = path.join(t.tmp, 'rove-fail');
      fs.mkdirSync(dir, { recursive: true });
      const { DatabaseSync } = require('node:sqlite');
      const conn = new DatabaseSync(path.join(dir, 'browser.db'));
      conn.exec(`CREATE TABLE credentials (id INTEGER PRIMARY KEY, password BLOB); CREATE TABLE form_profiles (id INTEGER PRIMARY KEY, data BLOB);
        INSERT INTO credentials (password) VALUES (x'00112233');`);
      fs.writeFileSync(path.join(dir, '.rekey-pending'), path.join(t.tmp, 'nowhere'));
      process.env.PB_OLD_NAME = require('electron').app.getName();
      try {
        const r = await rename.rekeyIfPending(conn, dir);
        t.assert.equal(r.lost, 1);
        t.assert.ok(r.error);
      } finally { delete process.env.PB_OLD_NAME; }
      t.assert.equal(conn.prepare('SELECT COUNT(*) AS n FROM credentials').get().n, 0);
      conn.close();
    },
  },
];
