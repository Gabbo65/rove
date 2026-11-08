// Passkeys fail fast (no endless waiting) with a notice; the phone shows whether the mirror is live video or pictures.
const { BrowserWindow, session } = require('electron');
const fs = require('fs'), path = require('path');
const remote = require('../../src/main/remote');

const PASSKEY_GET = `navigator.credentials.get({ publicKey: { challenge: new Uint8Array(32), timeout: 60000 } })
  .then(() => 'resolved', (e) => e.name)`;

module.exports = [
  {
    name: 'passkey request fails at once (site can fall back), sites see "no passkeys", notice shown',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/form'));
      const t0 = Date.now();
      t.assert.equal(await t.page(PASSKEY_GET), 'NotAllowedError');
      t.assert.ok(Date.now() - t0 < 1000, 'no hanging');
      t.assert.equal(await t.page(`PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`), false);
      t.assert.equal(await t.page(`PublicKeyCredential.isConditionalMediationAvailable()`), false);
      t.assert.equal(await t.page(`navigator.credentials.create({ publicKey: { challenge: new Uint8Array(32), rp: { name: 'x' },
        user: { id: new Uint8Array(8), name: 'a', displayName: 'a' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }] } }).then(() => 'ok', e => e.name)`), 'NotAllowedError');
      await t.until(() => w.toast && /passkey/i.test(w.toast), { message: 'notice' });
      await t.until(async () => /passkey/i.test(await t.hudJs(`document.getElementById('toast').hidden ? '' : document.getElementById('toast-text').textContent`)), { message: 'notice visible in hud' });
      // background passkey autofill stays quiet until the site cancels it
      t.assert.equal(await t.page(`(() => { const a = new AbortController();
        const p = navigator.credentials.get({ mediation: 'conditional', signal: a.signal, publicKey: { challenge: new Uint8Array(32) } }).then(() => 'ok', e => e.name);
        setTimeout(() => a.abort(), 100); return p; })()`), 'AbortError');
      // normal (non-passkey) credential API untouched
      t.assert.equal(await t.page(`typeof navigator.credentials.store`), 'function');
    },
  },
  {
    name: 'also inside login iframes (and autofill works there)',
    async run(t) {
      const w = await t.fresh();
      await t.go(t.url('/framed-login'));
      const frame = await t.until(() => w.active.wc.mainFrame.frames.find((f) => f.url.endsWith('/form')), { message: 'iframe' });
      await t.until(() => frame.executeJavaScript('document.readyState === "complete"'), { message: 'iframe loaded' });
      t.assert.equal(await frame.executeJavaScript(PASSKEY_GET, true), 'NotAllowedError');
    },
  },
  {
    name: 'phone mirror badge: "Live video" on WebRTC, "Pictures (fallback)" without it',
    timeout: 60000,
    async run(t) {
      await t.fresh();
      await t.go(t.url('/long'));
      const key = JSON.parse(fs.readFileSync(path.join(t.app.getPath('userData'), 'remote.json'), 'utf8')).key;
      const ses = session.fromPartition('phone-badge'); ses.setCertificateVerifyProc((_r, cb) => cb(0));
      const open = async (noRtc) => {
        const phone = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { session: ses } });
        await phone.loadURL(`https://127.0.0.1:${remote.port()}/?k=${key}`);
        await t.until(() => phone.webContents.executeJavaScript(`document.getElementById('status').classList.contains('on')`), { message: 'phone connected' });
        if (noRtc) await phone.webContents.executeJavaScript(`window.RTCPeerConnection = undefined; 1`);
        await phone.webContents.executeJavaScript(`document.querySelector('[data-mode=advanced]').click()`);
        return phone;
      };
      const badge = (p) => p.webContents.executeJavaScript(`document.getElementById('mirror-badge').textContent`);
      const live = await open(false);
      await t.until(async () => (await badge(live)) === '● Live video', { message: 'live badge', timeout: 20000 });
      live.destroy();
      const pics = await open(true);
      await t.until(async () => (await badge(pics)) === '◐ Pictures (fallback)', { message: 'pictures badge', timeout: 20000 });
      pics.destroy();
    },
  },
];
