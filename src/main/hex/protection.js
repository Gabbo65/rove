// Hex Magic → Protection: blocks ads, trackers and ad popups in every Rove window (on by default).
// Engine: Ghostery's open-source adblocker (MPL-2.0) with the standard lists (EasyList, EasyPrivacy, uBlock filters…).
// The lists download once, are kept in <userData>/adblock-engine.bin and refresh weekly; without internet Rove
// uses the last copy (or retries later). Nothing about your browsing is sent anywhere.
const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');
const settings = require('../settings');

const WEEK = 7 * 24 * 3600 * 1000;
const COSMETIC = ['@ghostery/adblocker/inject-cosmetic-filters', '@ghostery/adblocker/is-mutation-observer-enabled'];
let blocker = null, loading = null, retryT = null;
const sessions = new Set();   // every session Rove uses (normal + each InPrivate window)
const on = new Set();         // sessions where blocking is running
const stats = { blocked: 0, popups: 0 };

const enabled = () => settings.get('adblock') !== false;

// Ghostery runs its in-page scriptlets (YouTube has many) with webContents.executeJavaScript without waiting:
// a failing one became an "UnhandledPromiseRejection" in the terminal, and while the page loads Electron parks each
// one on a "did-stop-loading" listener (> 10 → "MaxListenersExceeded"). They also ran in the top page even when an
// embedded frame asked. Here: each runs in the frame that asked, right away, and its errors are caught.
function tameScriptlets(b) {
  const original = b.onInjectCosmeticFilters.bind(b);
  b.onInjectCosmeticFilters = (event, ...rest) => {
    const wc = event.sender, frame = event.senderFrame;
    const sender = {
      insertCSS: (css, o) => Promise.resolve(wc.isDestroyed() ? null : wc.insertCSS(css, o)).catch(() => {}),
      executeJavaScript: (code, gesture) => Promise.resolve(frame && !frame.detached ? frame.executeJavaScript(code, gesture)
        : wc.isDestroyed() ? null : wc.executeJavaScript(code, gesture)).catch(() => {}),
    };
    return original(new Proxy(event, { get: (t, k) => (k === 'sender' ? sender : Reflect.get(t, k)) }), ...rest);
  };
}

async function load() {
  if (blocker) return blocker;
  if (loading) return loading;
  loading = (async () => {
    const { ElectronBlocker } = require('@ghostery/adblocker-electron');
    const opts = { loadCosmeticFilters: true, loadNetworkFilters: true, enableCompression: true };
    let b;
    if (process.env.PB_ADBLOCK_LIST) { // tests: a small local list, no internet
      // (settings unlike Rove's own, like the downloaded lists have — so the merge below is tested for real)
      b = ElectronBlocker.parse(fs.readFileSync(process.env.PB_ADBLOCK_LIST, 'utf8'), { ...opts, enableCompression: false });
    } else {
      const cache = path.join(app.getPath('userData'), 'adblock-engine.bin');
      try { if (Date.now() - fs.statSync(cache).mtimeMs > WEEK) fs.renameSync(cache, `${cache}.old`); } catch {}
      try {
        b = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, { path: cache, read: fs.promises.readFile, write: fs.promises.writeFile });
        fs.rmSync(`${cache}.old`, { force: true });
      } catch (err) {
        // offline: fall back to last week's lists if we have them
        const old = await fs.promises.readFile(`${cache}.old`).catch(() => null);
        if (!old) throw err;
        b = ElectronBlocker.deserialize(new Uint8Array(old));
      }
    }
    // + Rove's own extra rules (ad tricks the public lists don't cover yet)
    // (added into the engine itself: merging engines needs identical settings and scriptlet bundles)
    const extra = fs.readFileSync(path.join(__dirname, 'protection-extra.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('!'));
    b.updateFromDiff({ added: extra });
    tameScriptlets(b);
    b.on('request-blocked', () => { stats.blocked++; });
    b.on('request-redirected', () => { stats.blocked++; });
    blocker = b;
    return b;
  })().finally(() => { loading = null; });
  return loading;
}

const PROTECT_PRELOAD = require('path').join(__dirname, '..', '..', 'preload', 'protect.js');
const frameGuards = new Map(); // session -> preload id (no popups from other sites' embedded frames)

function enableIn(ses) {
  if (!frameGuards.has(ses)) frameGuards.set(ses, ses.registerPreloadScript({ type: 'frame', filePath: PROTECT_PRELOAD }));
  if (!blocker || on.has(ses)) return;
  // Ghostery registers its two in-page message handlers per session; one set serves them all
  for (const ch of COSMETIC) ipcMain.removeHandler(ch);
  blocker.enableBlockingInSession(ses);
  on.add(ses);
}
function disableIn(ses) {
  if (frameGuards.has(ses)) { try { ses.unregisterPreloadScript(frameGuards.get(ses)); } catch {} frameGuards.delete(ses); }
  if (!blocker || !on.has(ses)) return;
  try { blocker.disableBlockingInSession(ses); } catch {}
  on.delete(ses);
}

async function apply() {
  if (!enabled()) { for (const s of sessions) disableIn(s); return; }
  for (const s of sessions) enableIn(s); // the frame guard works even before the lists load
  try {
    await load();
  } catch (err) {
    console.warn('[protection] lists not loaded yet:', err.message);
    clearTimeout(retryT);
    retryT = setTimeout(apply, 10 * 60 * 1000); // offline at first start: try again later
    retryT.unref?.();
    return;
  }
  if (!enabled()) return;
  for (const s of sessions) enableIn(s);
}

// Every Rove session (called when Rove prepares one).
function attach(ses) {
  sessions.add(ses);
  if (enabled()) enableIn(ses);
}

// A tab wants to open a popup / new tab: stop it when it points at an ad server.
function blocksPopup(url, sourceUrl, wc) {
  if (!enabled() || !/^https?:/i.test(url || '')) return false;
  if (strictBlocks(url, sourceUrl, wc)) return true;
  if (!blocker) return false;
  const { Request } = require('@ghostery/adblocker-electron');
  for (const type of ['main_frame', 'sub_frame', 'script']) {
    const r = blocker.match(Request.fromRawDetails({ url, sourceUrl: sourceUrl || '', type }));
    if (r.match && !r.exception) { stats.popups++; return true; }
  }
  return false;
}

// ---------- strict popups (chosen sites) ----------
// The page reports your real clicks on links (src/preload/protect.js); on a strict site a popup / new tab to
// another site opens only if it is the link you just clicked. Ad scripts can't fake a real click.
const linkClicks = new Map(); // webContents id -> { href, at }
ipcMain.on('protect:link', (e, href) => { linkClicks.set(e.sender.id, { href: String(href || '').slice(0, 4000), at: Date.now() }); });
const noHash = (u) => String(u || '').split('#')[0];
function clickedLink(wc, url) {
  const r = wc && linkClicks.get(wc.id);
  return !!r && Date.now() - r.at < 1500 && noHash(r.href) === noHash(url);
}
function strictOn(url) {
  const s = site(url);
  if (!s) return false;
  return (settings.get('adblockStrict') || []).some((p) => (p.endsWith('.*') ? s.split('.')[0] === p.slice(0, -2) : s === p));
}
function strictBlocks(url, sourceUrl, wc) {
  if (!strictOn(sourceUrl) || !/^https?:/i.test(url || '')) return false;
  if (site(url) === site(sourceUrl) || clickedLink(wc, url)) return false;
  stats.popups++;
  return true;
}

// "Site" = the registrable part of the host (www.a.example.co.uk → example.co.uk), good enough to tell sites apart.
function site(url) {
  let h = '';
  try { h = new URL(url).hostname.toLowerCase(); } catch { return ''; }
  if (/^[\d.]+$|:/.test(h)) return h; // IP addresses
  const p = h.split('.');
  const n = p.length >= 3 && p[p.length - 1].length === 2 && /^(co|com|org|net|gov|ac|edu)$/.test(p[p.length - 2]) ? 3 : 2;
  return p.slice(-n).join('.');
}

// An embedded frame from another site (a video player, an ad) trying to send the whole tab to a THIRD site:
// that's the ad trick of replacing your page with an ad. Your own clicks and the page's own links don't count.
function blocksTopNav(e, wc) {
  if (!enabled()) return false;
  const from = e.initiator;
  // strict sites: the page itself may not jump to another site unless you clicked that link
  if ((!from || from === wc.mainFrame) && strictBlocks(e.url, wc.getURL(), wc)) return true;
  if (!from || from === wc.mainFrame || !from.parent) return false;
  const top = site(wc.getURL()), by = site(from.url), to = site(e.url);
  if (!top || !by || by === top || to === top || to === by) return false;
  stats.popups++;
  return true;
}

function setup(core) {
  settings.on?.('change', (changed) => { if ('adblock' in changed) apply(); });
  core.register({ id: 'magic.protection', family: 'magic', kind: 'group', icon: 'shield', name: 'Protection',
    description: 'Ads, trackers and ad popups' });
  core.register({ id: 'magic.protection.on', family: 'magic', parent: 'magic.protection', icon: 'shield', name: 'Blocking', stay: true,
    description: 'Block ads, trackers and ad popups (on / off)',
    current: () => enabled(),
    run: () => { settings.set({ adblock: !enabled() }); return { message: enabled() ? 'Protection on' : 'Protection off' }; } });
  const here = () => core.getTarget()?.active?.url || '';
  core.register({ id: 'magic.protection.strict', family: 'magic', parent: 'magic.protection', icon: 'strict', name: 'Strict here', stay: true,
    description: 'On this site, new tabs to other sites open only from links you click',
    current: () => strictOn(here()),
    run: ({ tab }) => {
      const url = tab?.url || '', s = site(url);
      if (!s || !/^https?:/i.test(url)) throw new Error('Strict popups work on web pages');
      const list = settings.get('adblockStrict') || [];
      const name = s.split('.')[0];
      const next = strictOn(url) ? list.filter((p) => p !== s && p !== `${name}.*`) : [...list, s];
      settings.set({ adblockStrict: next });
      return { message: strictOn(url) ? `Strict popups on for ${s}` : `Strict popups off for ${s}` };
    } });
  apply();
}

module.exports = { _tameScriptlets: tameScriptlets, setup, attach, apply, blocksPopup, blocksTopNav, site, strictOn, enabled, stats, ready: () => !!blocker && on.size > 0, _load: load };
