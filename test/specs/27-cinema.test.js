// Hex Magic → Cinema: always opens on a live list of the page's videos; Extract (the tab moves in) or Duplicate
// (a copy plays, the page stays); swap between them; controls; big speed / volume panels.
const cinema = require('../../src/main/hex/cinema');

const until = (t, fn, message, timeout) => t.until(fn, { message, ...(timeout ? { timeout } : {}) });

async function openCinema(t, w) {
  const r = await t.hub.hex.run(w, 'magic.cinema');
  t.assert.ok(r.ok, JSON.stringify(r));
  const c = cinema.current();
  await until(t, () => c.base.isVisible() && !c.overlay.webContents.isLoading(), 'cinema window shown');
  const ui = (code) => c.overlay.webContents.executeJavaScript(code);
  const send = (cmd, x, y) => ui(`window.pb.invoke('cin:cmd', ${JSON.stringify(cmd)}, ${JSON.stringify(x ?? 0)}, ${JSON.stringify(y ?? null)})`);
  const state = () => ui(`window.pb.invoke('cin:state')`);
  const first = async () => { const v = (await state()).videos[0]; return { fid: v.fid, i: v.i }; };
  return { c, ui, send, state, first };
}

async function start(t, mode = 'extract') {
  const w = await t.fresh();
  await t.go(t.url('/video'));
  await until(t, () => t.page(`document.getElementById('v').readyState >= 2`), 'video loaded');
  await t.page(`document.getElementById('v').play()`);
  await until(t, () => t.page(`!document.getElementById('v').paused`), 'playing');
  const o = await openCinema(t, w);
  await until(t, async () => (await o.state()).videos?.length === 1, 'video listed');
  const r = await o.send('pick', await o.first(), mode);
  t.assert.ok(r.ok, JSON.stringify(r));
  await until(t, async () => (await o.state()).phase === 'play', 'playing in Cinema', 20000);
  return { w, tab: w.active, ...o };
}

const fills = (t, wc) => (wc ? wc.executeJavaScript.bind(wc) : t.page)(`(() => { const v = document.querySelector('video[data-hex-cinema]') || document.getElementById('v');
  const r = v.getBoundingClientRect(); return Math.abs(r.width - innerWidth) < 2 && Math.abs(r.height - innerHeight) < 2 && r.left === 0 && r.top === 0; })()`);

module.exports = [
  {
    name: 'Cinema helper code compiles (it lives in a template string, where a lost backslash breaks everything)',
    async run(t) { t.assert.doesNotThrow(() => new Function(cinema._helper)); },
  },
  {
    name: 'Cinema always opens: a live list of the page\'s videos (empty at first, filled as they load); Rove pages say so',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      const { state, ui, send } = await openCinema(t, w);
      let s = await state();
      t.assert.equal(s.phase, 'list');
      t.assert.deepEqual(s.videos, []);
      await until(t, () => ui(`!document.getElementById('none').hidden && /No videos yet/.test(document.getElementById('none').textContent)`), 'empty message');
      // an empty video (no source) isn't listed; a video appearing later shows up
      await t.page(`document.body.append(document.createElement('video'))`);
      await t.page(`{ const v = document.createElement('video'); v.src = '/clip.webm'; v.muted = true; document.body.append(v); }`);
      await until(t, () => ui(`document.querySelectorAll('#videos .vid').length === 1`), 'listed once it loads');
      await until(t, () => ui(`/192×108/.test(document.querySelector('#videos .t2').textContent)`), 'size shown');
      t.assert.ok(await ui(`[...document.querySelectorAll('#videos .vid button')].map((b) => b.textContent).join() === 'Extract,Duplicate'`));
      send('close').catch(() => {});
      await until(t, () => !cinema.current(), 'closed');
      await t.go('pb://settings/');
      const o = await openCinema(t, w);
      s = await o.state();
      t.assert.equal(s.web, false);
      await until(t, () => o.ui(`/web pages/.test(document.getElementById('none').textContent)`), 'says why');
      await cinema.close();
    },
  },
  {
    name: 'Extract: the tab moves into Cinema, only the video shows; ☰ gives the tab back; closing too',
    async run(t) {
      const { w, tab, c, send, state, first } = await start(t, 'extract');
      t.assert.ok(c.base.isAlwaysOnTop(), 'always on top');
      t.assert.ok(c.base.contentView.children.includes(tab.view) && !w.base.contentView.children.includes(tab.view), 'tab lives in Cinema');
      await until(t, () => fills(t), 'video fills the window');
      t.assert.equal(await t.page(`getComputedStyle(document.querySelector('h1')).visibility`), 'hidden');
      t.assert.equal(await t.page(`typeof window.__hexCin`), 'undefined', 'helper invisible to the page');
      t.assert.ok(await t.page(`!document.getElementById('v').paused`), 'keeps playing');
      t.assert.equal(tab.sleep(), false, 'never put to sleep');
      // Rove shows "Playing in Cinema" where the page was; its "Bring it back" works
      await until(t, () => t.ui(`!document.getElementById('cin-away').hidden`), 'placeholder in Rove');
      await t.ui(`document.getElementById('ca-back').click()`);
      await until(t, async () => (await state()).phase === 'list' && w.base.contentView.children.includes(tab.view), 'back to the list, tab back home');
      await until(t, () => t.ui(`document.getElementById('cin-away').hidden`), 'placeholder gone');
      t.assert.equal(await t.page(`getComputedStyle(document.querySelector('h1')).visibility`), 'visible', 'page normal again');
      t.assert.ok(cinema.current(), 'Cinema stays open on the list');
      await send('pick', await first(), 'extract');
      await until(t, async () => (await state()).phase === 'play', 'extracted again');
      // the window going away by itself (not via ✕) still gives the tab back
      c.base.close();
      await until(t, () => !cinema.current() && c.base.isDestroyed(), 'closed');
      await until(t, () => w.base.contentView.children.includes(tab.view), 'tab back in its window');
      t.assert.equal(await t.page(`getComputedStyle(document.getElementById('v')).position`), 'static');
    },
  },
  {
    name: 'Duplicate: the page stays in Rove (its video paused), a copy plays in Cinema from the same moment; ⇄ swaps both ways',
    timeout: 40000,
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/video'));
      await until(t, () => t.page(`document.getElementById('v').readyState >= 2`), 'video loaded');
      await t.page(`document.getElementById('v').currentTime = 3`);
      const tab = w.active;
      const { c, send, state, first } = await openCinema(t, w);
      await until(t, async () => (await state()).videos?.length === 1, 'listed');
      t.assert.ok((await send('pick', await first(), 'duplicate')).ok);
      t.assert.ok(w.base.contentView.children.includes(tab.view), 'the page stays in Rove');
      t.assert.equal(await t.page(`getComputedStyle(document.querySelector('h1')).visibility`), 'visible', 'the page is untouched');
      t.assert.ok(await t.page(`document.getElementById('v').paused`), 'original paused (no double sound)');
      const copy = c.copy.webContents;
      t.assert.notEqual(copy, tab.wc);
      await until(t, () => fills(t, copy), 'copy shows only the video');
      const s = await state();
      t.assert.equal(s.mode, 'duplicate');
      t.assert.ok(Math.abs(s.t - 3) < 0.6, `same moment (${s.t})`);
      t.assert.equal(await copy.executeJavaScript('typeof window.pb'), 'undefined', 'no Rove bridge in the copy');
      // ⇄ → Extract: the copy goes away, the tab moves in at the copy's moment
      await send('seek', 5);
      t.assert.ok((await send('swap')).ok);
      await until(t, async () => (await state()).mode === 'extract', 'now extracted');
      t.assert.ok(copy.isDestroyed(), 'copy closed');
      t.assert.ok(c.base.contentView.children.includes(tab.view));
      t.assert.ok(Math.abs((await t.page(`document.getElementById('v').currentTime`)) - 5) < 0.6, 'kept the moment');
      // ⇄ → Duplicate again: the tab goes home
      t.assert.ok((await send('swap')).ok);
      await until(t, async () => (await state()).mode === 'duplicate' && w.base.contentView.children.includes(tab.view), 'duplicate again');
      await cinema.close();
      t.assert.ok(!cinema.current());
    },
  },
  {
    name: 'Cinema controls: play/pause, seek, speed 0.0625×–16×, volume boost, A–B loop, download; big speed / volume panels; only its own window may use them',
    async run(t) {
      const { c, send, state, ui } = await start(t, 'extract');
      const v = (p) => t.page(`document.getElementById('v').${p}`);
      await send('play'); await until(t, () => v('paused'), 'paused');
      await send('seek', 3); await until(t, async () => Math.abs((await v('currentTime')) - 3) < 0.2, 'seeked');
      await send('skip', 2); await until(t, async () => Math.abs((await v('currentTime')) - 5) < 0.2, 'skipped');
      await send('rate', 16); t.assert.equal(await v('playbackRate'), 16);
      await send('rate', 0.01); t.assert.equal(await v('playbackRate'), 0.0625, 'clamped');
      await t.page(`document.getElementById('v').playbackRate = 1`);
      await until(t, async () => (await v('playbackRate')) === 0.0625, 'the page can\'t undo the chosen speed');
      await send('rate', 1);
      t.assert.ok((await send('vol', 2.5)).ok);
      t.assert.equal((await state()).vol, 2.5);
      await send('seek', 1); await send('a'); await send('seek', 1.6); await send('b');
      const s = await state();
      t.assert.ok(Math.abs(s.a - 1) < 0.2 && s.b > s.a, `loop ${s.a}–${s.b}`);
      await send('seek', 1.5); await send('play');
      await until(t, async () => (await v('currentTime')) < 1.4, 'loops back to A', 5000);
      t.assert.match((await state()).file, /\/clip\.webm$/);
      t.assert.equal((await send('download')).message, 'Saving to Downloads…');
      // hovering the speed icon opens a big panel (about half the window) showing the speed
      await ui(`document.getElementById('speed').dispatchEvent(new MouseEvent('mouseenter')); 1`);
      const big = await ui(`(() => { const b = document.getElementById('big'), r = b.getBoundingClientRect();
        return { shown: !b.hidden, w: r.width / innerWidth, h: r.height / innerHeight, v: document.getElementById('bigv').textContent }; })()`);
      t.assert.ok(big.shown && big.w >= 0.45 && big.h >= 0.45, JSON.stringify(big));
      t.assert.equal(big.v, '1×');
      await ui(`document.getElementById('big').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true })); 1`);
      await until(t, async () => (await v('playbackRate')) === 1.25, 'scroll on the panel speeds up');
      await ui(`document.getElementById('volume').dispatchEvent(new MouseEvent('mouseenter')); 1`);
      await until(t, () => ui(`document.getElementById('bigv').textContent === '250%' && document.getElementById('bigv').classList.contains('boost')`), 'volume panel shows the boost');
      await t.assert.rejects(t.ui(`window.pb.invoke('cin:cmd', 'close')`), /not allowed|blocked/);
      t.assert.ok(cinema.current(), 'still open');
      await send('opacity', 0.5); t.assert.ok(Math.abs(c.base.getOpacity() - 0.5) < 0.02);
      await cinema.close();
    },
  },
  {
    name: 'Cinema: leaving the page goes back to the list (tab given back); closing the tab ends Cinema',
    async run(t) {
      const a = await start(t, 'extract');
      await t.go(t.url('/p2'));
      await until(t, async () => (await a.state()).phase === 'list' && a.w.base.contentView.children.includes(a.tab.view), 'list again, tab home');
      t.assert.match((await a.state()).note, /page changed/);
      await cinema.close();
      const b = await start(t, 'extract');
      b.w.close(b.tab);
      await until(t, () => !cinema.current() && b.c.base.isDestroyed(), 'closing the tab ends Cinema');
    },
  },
  {
    name: 'Cinema: swapping keeps speed and volume; ☰ cancels a copy still loading; ⌘W closes Cinema, not a Rove tab',
    timeout: 40000,
    async run(t) {
      const { w, tab, c, send, state, first } = await start(t, 'extract');
      await send('rate', 2); await send('vol', 0.5);
      t.assert.ok((await send('swap')).ok);
      await until(t, async () => { const s = await state(); return s.mode === 'duplicate' && s.rate === 2 && Math.abs(s.vol - 0.5) < 0.01; }, 'speed and volume carried over');
      await send('list');
      // pick Duplicate and cancel at once: back to the list without waiting
      const p = send('pick', await first(), 'duplicate');
      await until(t, async () => (await state()).phase !== 'list', 'loading');
      const t0 = Date.now();
      await send('list');
      await p;
      t.assert.ok(Date.now() - t0 < 3000, 'cancelled quickly');
      t.assert.equal((await state()).phase, 'list');
      t.assert.ok(!c.copy, 'copy dropped');
      // ⌘W inside Cinema closes Cinema only
      const tabs = w.tabs.length;
      c.overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
      await until(t, () => !cinema.current(), 'Cinema closed');
      t.assert.equal(w.tabs.length, tabs, 'no Rove tab closed');
      t.assert.ok(w.base.contentView.children.includes(tab.view));
    },
  },
  {
    name: 'Cinema finds a video inside an embedded player from another site; Extract and Duplicate show it full-window',
    timeout: 40000,
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/video-in-frame'));
      const tab = w.active;
      const pf = () => tab.wc.mainFrame.frames.find((f) => /\/video$/.test(f.url));
      await t.until(() => pf() && pf().executeJavaScript(`document.getElementById('v').readyState >= 2`), { message: 'player loaded' });
      const { c, send, state, ui } = await openCinema(t, w);
      await until(t, async () => (await state()).videos?.length === 1, 'the framed video is listed');
      const v = (await state()).videos[0];
      t.assert.ok(v.inFrame && v.frameHost === 'localhost', JSON.stringify(v));
      await until(t, () => ui(`/in a player from localhost/.test(document.querySelector('#videos .t2').textContent)`), 'says where it plays');
      // Extract: the player frame fills the page, the video fills the player
      t.assert.ok((await send('pick', { fid: v.fid, i: v.i }, 'extract')).ok);
      await until(t, async () => (await state()).phase === 'play', 'playing');
      const frameFills = () => t.page(`(() => { const f = document.getElementById('pf'), r = f.getBoundingClientRect(); return Math.abs(r.width - innerWidth) < 2 && Math.abs(r.height - innerHeight) < 2 && r.top === 0; })()`, tab);
      const videoFills = (fr) => fr.executeJavaScript(`(() => { const r = document.getElementById('v').getBoundingClientRect(); return Math.abs(r.width - innerWidth) < 2 && Math.abs(r.height - innerHeight) < 2; })()`);
      await until(t, frameFills, 'player frame fills the window');
      await until(t, () => videoFills(pf()), 'video fills the player');
      t.assert.equal(await t.page(`getComputedStyle(document.querySelector('h1')).visibility`, tab), 'hidden');
      t.assert.equal(await pf().executeJavaScript('typeof window.__hexCin'), 'undefined', 'helper hidden from the player page');
      await send('rate', 2);
      t.assert.equal(await pf().executeJavaScript(`document.getElementById('v').playbackRate`), 2, 'controls reach the framed video');
      // ⇄ Duplicate: the page comes back untouched, the copy shows the framed video
      t.assert.ok((await send('swap')).ok);
      await until(t, async () => (await state()).mode === 'duplicate', 'duplicate');
      await until(t, async () => !(await frameFills()), 'page back to normal');
      const cpf = () => c.copy.webContents.mainFrame.frames.find((f) => /\/video$/.test(f.url));
      await until(t, () => cpf() && videoFills(cpf()), 'copy shows the framed video full-window');
      t.assert.equal((await state()).rate, 2, 'speed carried');
      await cinema.close();
      t.assert.equal(await t.page(`getComputedStyle(document.querySelector('h1')).visibility`, tab), 'visible');
    },
  },
  {
    name: 'Cinema ⤓ saves a real video file (from the ⤓ button itself) into Downloads',
    async run(t) {
      const downloads = require('../../src/main/downloads');
      const fs = require('fs');
      downloads.action(null, 'clear'); // only what this test saves
      for (const d of downloads.list()) if (d.path && /clip.*\.webm$/.test(d.path)) fs.rmSync(d.path, { force: true });
      t.assert.equal(downloads.list().filter((d) => /clip/.test(d.path || '')).length, 0);
      const { ui } = await start(t, 'extract');
      await until(t, () => ui(`document.getElementById('dl').style.opacity === '1'`), 'download offered for a real file');
      await ui(`document.dispatchEvent(new MouseEvent('mousemove')); document.getElementById('dl').click(); 1`);
      await until(t, () => downloads.list().some((d) => /clip.*\.webm$/.test(d.path || d.filename || '') && d.state === 'completed'), 'file saved', 10000);
      const d = downloads.list().find((x) => /clip.*\.webm$/.test(x.path || ''));
      t.assert.ok(fs.existsSync(d.path) && fs.statSync(d.path).size === fs.statSync(require('path').join(__dirname, '..', 'fixtures', 'clip.webm')).size, 'the whole file');
      await cinema.close();
    },
  },
  {
    name: 'Cinema ⤓ on a streamed video saves the open stream as one real file (best quality, all pieces in order); encrypted streams are refused',
    async run(t) {
      const fs = require('fs'), path = require('path');
      const dir = require('../../src/main/downloads').folder();
      const before = new Set(fs.readdirSync(dir));
      const w = await t.fresh();
      await t.go(t.url('/stream'));
      await until(t, () => t.page(`document.getElementById('v').readyState >= 1 && performance.getEntriesByType('resource').some((e) => /master/.test(e.name))`), 'blob video + playlist loaded');
      await t.page(`document.getElementById('v').play().catch(() => {}); 1`);
      const o = await openCinema(t, w);
      await until(t, async () => (await o.state()).videos?.length === 1, 'listed');
      t.assert.ok((await o.send('pick', await o.first(), 'extract')).ok);
      await until(t, async () => (await o.state()).stream === true, 'stream detected');
      t.assert.equal((await o.state()).file, '', 'not a plain file');
      await until(t, () => o.ui(`document.getElementById('dl').style.opacity === '1'`), '⤓ offered');
      t.assert.match((await o.send('download')).message, /Saving the stream/);
      await until(t, async () => /Saved to Downloads: My Stream\.ts/.test((await o.state()).saveNote || ''), 'saved', 15000);
      const made = fs.readdirSync(dir).filter((f) => !before.has(f) && /^My Stream.*\.ts$/.test(f));
      t.assert.equal(made.length, 1, JSON.stringify(made));
      const out = fs.readFileSync(path.join(dir, made[0]));
      const parts = ['seg0.ts', 'seg1.ts', 'seg2.ts', 'seg3.ts'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'hls', f)));
      t.assert.ok(out.equals(Buffer.concat(parts)), 'exactly the 4 pieces of the best quality, in order');
      t.assert.equal(out[0], 0x47, 'a real MPEG-TS file');
      fs.rmSync(path.join(dir, made[0]));
      await cinema.close();
      // an encrypted stream: refused, nothing written
      await t.go(t.url('/stream?locked'));
      await until(t, () => t.page(`document.getElementById('v').readyState >= 1 && performance.getEntriesByType('resource').some((e) => /locked/.test(e.name))`), 'loaded');
      const p = await openCinema(t, w);
      await until(t, async () => (await p.state()).videos?.length === 1, 'listed');
      await p.send('pick', await p.first(), 'extract');
      await until(t, async () => (await p.state()).stream === true, 'stream detected');
      await p.send('download');
      await until(t, async () => /encrypted/.test((await p.state()).saveNote || ''), 'refused');
      t.assert.equal(fs.readdirSync(dir).filter((f) => !before.has(f) && /^My Stream/.test(f)).length, 0, 'nothing saved');
      await cinema.close();
    },
  },
];
