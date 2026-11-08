// Phone remote: connection + key check (unchanged security), control of the active tab, tab/favorite lists,
// trackpad cursor, and the mirror: live video (WebRTC) with automatic picture (JPEG) fallback.
const { BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const remote = require('../../src/main/remote');
const favorites = require('../../src/main/favorites');

function key(t) { return JSON.parse(fs.readFileSync(path.join(t.app.getPath('userData'), 'remote.json'), 'utf8')).key; }

function connect(t, k = key(t)) {
  const ws = new WebSocket(`wss://127.0.0.1:${remote.port()}/ws?k=${k}`, { rejectUnauthorized: false });
  const msgs = []; let frames = 0;
  ws.on('message', (d, bin) => { if (bin) frames++; else msgs.push(JSON.parse(d)); });
  const last = (type) => [...msgs].reverse().find((m) => m.type === type);
  return {
    ws, msgs, last, frames: () => frames,
    open: () => new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); }),
    send: (m) => ws.send(JSON.stringify(m)),
    close: () => new Promise((res) => { ws.once('close', res); ws.close(); }),
  };
}

module.exports = [
  {
    name: 'wrong key is refused; right key connects and gets state, tabs, favorites',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      const bad = connect(t, 'nope');
      const code = await new Promise((r) => bad.ws.on('close', (c) => r(c)));
      t.assert.equal(code, 4001);
      const c = connect(t);
      await c.open();
      await t.until(() => c.last('state') && c.last('tabs') && c.last('favorites'), { message: 'initial messages' });
      t.assert.equal(c.last('state').title, 'Page One');
      t.assert.equal(c.last('tabs').tabs.length, 1);
      await t.until(() => w.qrVisible === false, { message: 'QR hides when a phone connects' });
      await c.close();
      await t.until(() => w.qrVisible === true, { message: 'QR back when it leaves' });
    },
  },
  {
    name: 'phone navigates, switches/opens/closes tabs, opens and stars favorites',
    async run(t) {
      t.db().exec('DELETE FROM favorites');
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      const c = connect(t); await c.open();
      c.send({ type: 'nav', action: 'go', input: t.url('/p2') });
      await t.until(() => c.last('state')?.title === 'Page Two', { message: 'navigated' });
      c.send({ type: 'tab', action: 'new' });
      await t.until(() => w.tabs.length === 2 && c.last('tabs').tabs.length === 2, { message: 'new tab' });
      c.send({ type: 'tab', action: 'select', id: w.tabs[0].id });
      await t.until(() => w.active === w.tabs[0], { message: 'selected' });
      c.send({ type: 'tab', action: 'close', id: w.tabs[1].id });
      await t.until(() => w.tabs.length === 1, { message: 'closed' });
      c.send({ type: 'fav', action: 'toggle' });
      await t.until(() => favorites.list().length === 1 && c.last('favorites').favorites.length === 1, { message: 'starred from phone' });
      await t.until(async () => !(await t.ui(`document.getElementById('fav-pop').hidden`)), { message: 'Mac shows the name popup' });
      await t.ui(`document.getElementById('fp-cancel').click()`);
      c.send({ type: 'fav', action: 'open-new', url: t.url('/p3') });
      await t.until(() => w.tabs.length === 2 && w.active.title === 'Page Three', { message: 'fav in new tab' });
      c.send({ type: 'fav', action: 'open', url: 'javascript:alert(1)' });
      await t.sleep(200);
      t.assert.equal(w.active.title, 'Page Three', 'only web addresses open');
      await c.close();
    },
  },
  {
    name: 'trackpad: cursor view follows, tap clicks the page, two-finger scroll scrolls',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/scroll'));
      const c = connect(t); await c.open();
      c.send({ type: 'move', dx: -5000, dy: -5000 });
      c.send({ type: 'move', dx: 100, dy: 100 });
      await t.until(() => w.cursorOn && w.base.contentView.children.includes(w.cursor), { message: 'cursor shown' });
      const b = w.cursor.getBounds();
      t.assert.deepEqual([b.x, b.y], [w.content.x + 100 - 12, w.content.y + 100 - 12]);
      c.send({ type: 'scroll', dx: 0, dy: -400 });
      await t.until(async () => (await t.page('scrollY')) > 100, { message: 'scrolled' });
      await t.page(`window.__clicked = 0; document.addEventListener('click', () => window.__clicked++)`);
      c.send({ type: 'click' });
      await t.until(async () => (await t.page('window.__clicked')) === 1, { message: 'clicked' });
      await c.close();
    },
  },
  {
    name: 'mirror without video support: pictures only while Advanced, stop in Basic',
    async run(t) {
      await t.fresh();
      await t.go(t.url('/long'));
      const c = connect(t); await c.open();
      c.send({ type: 'mode', mode: 'advanced', rtc: false });
      await t.until(() => c.frames() > 0, { message: 'JPEG frames' });
      c.send({ type: 'mode', mode: 'basic' });
      await t.sleep(200);
      const n = c.frames();
      await t.page(`document.body.style.background = 'red'`);
      await t.sleep(600);
      t.assert.equal(c.frames(), n, 'no frames in Basic');
      await c.close();
    },
  },
  {
    name: 'mirror with video: the real phone page plays live WebRTC video of the tab',
    timeout: 60000,
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/long'));
      // A real Chromium page standing in for Safari on the phone.
      const ses = session.fromPartition('phone-test');
      ses.setCertificateVerifyProc((_req, cb) => cb(0)); // the remote's certificate is self-signed
      const phone = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { session: ses } });
      await phone.loadURL(`https://127.0.0.1:${remote.port()}/?k=${key(t)}`);
      await t.until(() => phone.webContents.executeJavaScript(`document.getElementById('status').classList.contains('on')`), { message: 'phone connected' });
      await phone.webContents.executeJavaScript(`document.querySelector('[data-mode=advanced]').click()`);
      await t.until(() => [...remote._clients].some((c) => c.rtc === 'connected'), { message: 'video connected', timeout: 20000 });
      await t.until(() => phone.webContents.executeJavaScript(`(() => { const v = document.getElementById('video'); return !v.hidden && v.videoWidth > 0; })()`),
        { message: 'video playing on phone', timeout: 20000 });
      const size = await phone.webContents.executeJavaScript(`[document.getElementById('video').videoWidth, document.getElementById('video').videoHeight]`);
      t.assert.ok(size[0] >= 600 && size[1] >= 300, `video ${size}`);
      // switching tabs keeps the same video connection
      const second = w.newTab(t.url('/p1')); await t.loaded(second);
      await t.sleep(800);
      t.assert.ok([...remote._clients].some((c) => c.rtc === 'connected'), 'still connected after tab switch');
      // tap on the video clicks the page
      await t.page(`window.__clicked = 0; document.addEventListener('click', () => window.__clicked++)`, second);
      await phone.webContents.executeJavaScript(`(() => {
        const box = document.getElementById('mirror'), r = document.getElementById('video').getBoundingClientRect();
        const touch = (type, list) => box.dispatchEvent(new TouchEvent(type, { touches: list, changedTouches: list, bubbles: true, cancelable: true }));
        const p = new Touch({ identifier: 1, target: box, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
        touch('touchstart', [p]); touch('touchend', []);
      })()`);
      await t.until(async () => (await t.page('window.__clicked', second)) === 1, { message: 'tap clicked the page' });
      // Basic → video stops
      await phone.webContents.executeJavaScript(`document.querySelector('[data-mode=basic]').click()`);
      await t.until(() => ![...remote._clients].some((c) => c.rtc === 'connected' || c.rtc === 'pending'), { message: 'video stopped' });
      phone.destroy();
    },
  },
];
