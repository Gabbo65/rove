// Phone remote: secret link + pairing + limits, control of the active tab, tab/favorite lists,
// trackpad cursor, and the mirror: live video (WebRTC) with automatic picture (JPEG) fallback.
const { BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const remote = require('../../src/main/remote');
const favorites = require('../../src/main/favorites');

function key(t) { return JSON.parse(fs.readFileSync(path.join(t.app.getPath('userData'), 'remote.json'), 'utf8')).key; }

// The test talks to the app's own self-made certificate on 127.0.0.1, so it can't verify it like a phone would.
function connect(t, k = key(t), { device = '', origin } = {}) {
  const d = device ? `&d=${device}` : '';
  const ws = new WebSocket(`wss://127.0.0.1:${remote.port()}/ws?k=${k}${d}`, { rejectUnauthorized: false, ...(origin ? { origin } : {}) });
  const msgs = []; let frames = 0;
  ws.on('message', (d, bin) => { if (bin) frames++; else msgs.push(JSON.parse(d)); });
  const last = (type) => [...msgs].reverse().find((m) => m.type === type);
  return {
    ws, msgs, last, frames: () => frames,
    open: () => new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); }),
    closed: () => new Promise((res) => ws.once('close', (code) => res(code))),
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
  {
    name: 'network change: offline → QR says "connect to Wi-Fi"; back online → new address, certificate and QR',
    async run(t) {
      const os = require('os');
      const real = os.networkInterfaces;
      const before = remote.status();
      await t.fresh();
      try {
        os.networkInterfaces = () => ({ lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] });
        t.assert.equal(await remote.checkAddress(), true, 'noticed going offline');
        t.assert.ok(remote.status().offline);
        t.assert.match(remote.status().url, /^https:\/\/127\.0\.0\.1:/);
        await t.until(async () => (await t.hudJs(`document.getElementById('qr-title').textContent`)) === 'Connect this computer to Wi-Fi', { message: 'QR card says offline' });
        os.networkInterfaces = () => ({ en9: [{ family: 'IPv4', internal: false, address: '10.9.8.7' }] });
        t.assert.equal(await remote.checkAddress(), true, 'noticed the new network');
        t.assert.equal(remote.status().offline, false);
        t.assert.match(remote.status().url, /^https:\/\/10\.9\.8\.7:/);
        t.assert.notEqual(remote.status().qr, before.qr, 'new QR code');
        t.assert.ok(require('fs').existsSync(require('path').join(t.app.getPath('userData'), 'tls', '10.9.8.7.crt')), 'certificate for the new address');
        await t.until(async () => (await t.hudJs(`document.getElementById('qr-title').textContent`)) !== 'Connect this computer to Wi-Fi', { message: 'QR card back to normal' });
        t.assert.equal(await remote.checkAddress(), false, 'no change, nothing done');
      } finally {
        os.networkInterfaces = real;
        await remote.checkAddress();
      }
    },
  },
  {
    name: 'secret link: 128-bit key, constant tries limit, only the phone page may connect, size limits',
    async run(t) {
      await t.fresh();
      remote._resetLimits();
      t.assert.match(key(t), /^[0-9a-f]{32}$/, '128-bit key');
      if (process.platform !== 'win32') {
        t.assert.equal(fs.statSync(path.join(t.app.getPath('userData'), 'remote.json')).mode & 0o077, 0, 'only you can read it');
      }
      // another web page (different origin) can't open the phone connection, even with the key
      const evil = connect(t, key(t), { origin: 'https://evil.example' });
      t.assert.equal(await evil.closed(), 4003);
      // too many wrong keys → this address is refused for a while, even with the right key
      for (let i = 0; i < 10; i++) { const b = connect(t, 'x'.repeat(32)); t.assert.equal(await b.closed(), 4001); }
      const locked = connect(t);
      t.assert.equal(await locked.closed(), 4029, 'blocked after 10 wrong keys');
      remote._resetLimits();
      // huge messages are refused
      const c = connect(t); await c.open();
      const gone = c.closed();
      c.ws.send('x'.repeat(1024 * 1024));
      t.assert.equal(await gone, 1009, 'message too big');
    },
  },
  {
    name: 'pairing: a new phone must be allowed once, then reconnects with its token; remove / new link / off',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/p1'));
      await remote.newLink(); // start with no paired phones
      remote._resetLimits();
      const asked = [];
      remote._approve = async (who) => { asked.push(who); return asked.length > 1; };
      try {
        // first phone: refused on the computer
        const no = connect(t);
        t.assert.equal(await no.closed(), 4003, 'not allowed');
        remote._resetLimits();
        // allowed → gets its own device token
        const yes = connect(t); await yes.open();
        await t.until(() => yes.last('paired') && yes.last('state'), { message: 'paired' });
        const token = yes.last('paired').token;
        t.assert.match(token, /^[0-9a-f]{32}$/);
        t.assert.equal(asked.length, 2);
        await yes.close();
        // reconnect with the token: no question
        const again = connect(t, key(t), { device: token }); await again.open();
        await t.until(() => again.last('state'), { message: 'reconnected' });
        t.assert.equal(asked.length, 2, 'not asked again');
        const info = remote.info();
        t.assert.equal(info.devices.length, 1);
        t.assert.equal(info.devices[0].connected, true);
        t.assert.ok(!JSON.stringify(info).includes(token), 'Settings never sees the token');
        // remove the phone → disconnected, its token no longer works
        const dropped = again.closed();
        remote.forgetDevice(info.devices[0].id);
        t.assert.equal(await dropped, 4001);
        // phone may only open web addresses
        const p2 = connect(t); await p2.open(); await t.until(() => p2.last('state'), { message: 'p2' });
        p2.send({ type: 'nav', action: 'go', input: 'file:///etc/hosts' });
        p2.send({ type: 'fav', action: 'open', url: 'file:///etc/hosts' });
        await t.sleep(300);
        t.assert.equal(w.active.title, 'Page One', 'no local files from the phone');
        // new link: old key refused, every phone forgotten, QR changes
        const oldKey = key(t), oldQr = remote.status().qr;
        const kicked = p2.closed();
        await remote.newLink();
        t.assert.equal(await kicked, 4001);
        t.assert.notEqual(key(t), oldKey);
        t.assert.notEqual(remote.status().qr, oldQr);
        t.assert.equal(remote.info().devices.length, 0);
        const stale = connect(t, oldKey);
        t.assert.equal(await stale.closed(), 4001);
        remote._resetLimits();
        // turned off in Settings: nothing listens; QR card says so; on again works
        const p3 = connect(t); await p3.open();
        const off = p3.closed();
        t.settings.set({ remoteEnabled: false });
        t.assert.equal(await off, 4000);
        await t.until(() => remote.status().disabled, { message: 'off' });
        const refused = connect(t);
        const err = await new Promise((r) => { refused.ws.once('error', (e) => r(e)); refused.ws.once('open', () => r(null)); });
        t.assert.ok(err && /ECONNREFUSED/.test(err.code || err.message), 'nothing listening');
        w.toggleQR(true);
        await t.until(async () => (await t.hudJs(`document.getElementById('qr-title').textContent`, w)) === 'Phone remote is off', { message: 'QR card says off' });
        t.settings.set({ remoteEnabled: true });
        await t.until(() => !remote.status().disabled && remote.status().qr, { message: 'on again' });
        const p4 = connect(t); await p4.open();
        await t.until(() => p4.last('state'), { message: 'works again' });
        await p4.close();
      } finally {
        remote._approve = null;
        remote._resetLimits();
        t.settings.set({ remoteEnabled: true });
      }
    },
  },
];
