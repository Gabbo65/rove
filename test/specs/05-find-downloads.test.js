// Find bar (hud over the page) and downloads (folder, unique names, pause/resume/cancel, stored list).
const fs = require('fs');
const path = require('path');
const downloads = require('../../src/main/downloads');

module.exports = [
  {
    name: 'find: ⌘F opens the bar over the page, counts matches, next/prev, Esc closes',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/long'));
      w.openFind();
      await t.until(() => w.hudSize.width > 0 && w.base.contentView.children.includes(w.hud), { message: 'hud shown' });
      await t.hudJs(`{ const i = document.getElementById('find-input'); i.value = 'browser'; i.dispatchEvent(new Event('input')); }`);
      const count = () => t.hudJs(`document.getElementById('find-count').textContent`);
      await t.until(async () => (await count()) === '1/80', { message: 'match count' });
      await t.hudJs(`document.getElementById('find-next').click()`);
      await t.until(async () => (await count()) === '2/80', { message: 'next' });
      await t.hudJs(`document.getElementById('find-prev').click()`);
      await t.until(async () => (await count()) === '1/80', { message: 'prev' });
      await t.hudJs(`{ const i = document.getElementById('find-input'); i.value = 'zzqqxx'; i.dispatchEvent(new Event('input')); }`);
      await t.until(async () => (await count()) === '0/0', { message: 'no matches' });
      await t.hudJs(`document.getElementById('find-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await t.until(() => !w.findOpen, { message: 'closed' });
      await t.until(() => !w.base.contentView.children.includes(w.hud) || w.qrVisible, { message: 'hud hidden' });
    },
  },
  {
    name: 'downloads go to the folder with unique names, panel opens, list is stored',
    async run(t) {
      t.db().exec('DELETE FROM downloads');
      downloads.action(null, 'clear');
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      const dir = path.join(t.tmp, 'Downloads');
      for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
      w.active.wc.downloadURL(t.url('/file.bin'));
      await t.until(() => downloads.list()[0]?.state === 'completed', { message: 'download 1' });
      w.active.wc.downloadURL(t.url('/file.bin'));
      await t.until(() => downloads.list().filter((d) => d.state === 'completed').length === 2, { message: 'download 2' });
      t.assert.deepEqual(fs.readdirSync(dir).sort(), ['file (1).bin', 'file.bin']);
      t.assert.equal(fs.statSync(path.join(dir, 'file.bin')).size, 300 * 1024);
      await t.until(async () => (await t.ui(`document.querySelectorAll('#dl-list .dl-row').length`)) === 2, { message: 'panel rows' });
      t.assert.ok(!(await t.ui(`document.getElementById('dl-btn').hidden`)));
      t.assert.equal(t.db().prepare('SELECT COUNT(*) AS n FROM downloads').get().n, 2);
    },
  },
  {
    name: 'downloads: pause, resume, cancel',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      w.active.wc.downloadURL(t.url('/slow.bin'));
      const d = () => downloads.list().find((x) => x.name.startsWith('slow'));
      await t.until(() => d()?.received > 0, { message: 'started' });
      downloads.action(d().id, 'pause');
      await t.until(() => d().paused, { message: 'paused' });
      const at = d().received;
      await t.sleep(500);
      t.assert.ok(d().received - at < 150 * 1024, 'no progress while paused');
      downloads.action(d().id, 'resume');
      await t.until(() => !d().paused && d().received > at, { message: 'resumed' });
      downloads.action(d().id, 'cancel');
      await t.until(() => d().state === 'cancelled', { message: 'cancelled' });
    },
  },
];
