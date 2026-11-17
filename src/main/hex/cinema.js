// Hex Magic → Cinema: a window that stays on top and plays one video of the current tab.
// It always opens: first a live list of the page's videos — also the ones inside embedded players from other
// sites — then the chosen one in one of two modes:
//   Extract:   the tab itself moves into Cinema (Rove shows "Playing in Cinema" there until Cinema lets it go);
//   Duplicate: Cinema loads its own copy of the page (same session, so logins work) and the tab stays as it is.
// Controls sit in a see-through view on top. The helper runs in an isolated world in each frame involved: it sees
// the page's DOM, never the page's JavaScript (and the page can't see it). In embedded frames it is started by
// src/preload/cinema-frame.js on Rove's request.
const path = require('path');
const { ipcMain } = require('electron');

const WORLD = 1077;
const FRAME_PRELOAD = path.join(__dirname, '..', '..', 'preload', 'cinema-frame.js');

// Only the chosen video shows — or, in a page holding the player, the player's frame — filling the window.
// Everything else is made invisible, not removed. Ancestors lose transforms so "fixed" really means the window.
const CSS = `
html, body { background: #000 !important; overflow: hidden !important; }
body * { visibility: hidden !important; }
[data-hex-cin-anc] { transform: none !important; filter: none !important; backdrop-filter: none !important;
  contain: none !important; perspective: none !important; will-change: auto !important; }
[data-hex-cinema] { visibility: visible !important; position: fixed !important; inset: 0 !important;
  width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important;
  min-width: 0 !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; border: 0 !important;
  z-index: 2147483647 !important; object-fit: contain !important; background: #000 !important;
  transform: none !important; opacity: 1 !important; }`;

const HELPER = `(() => {
  if (window.__hexCin) return true;
  let v = null, want = 0, a = null, b = null, loopT = 0, audio = null, was = false, sheet = null, kicking = false;
  const all = () => [...document.querySelectorAll('video')];
  const keepRate = () => { if (v && want && Math.abs(v.playbackRate - want) > 1e-3) v.playbackRate = want; };
  const boostOk = () => {
    const src = v.currentSrc || '';
    if (!src || /^(blob|data):/.test(src) || v.crossOrigin != null) return true;
    try { return new URL(src).origin === location.origin; } catch { return false; }
  };
  // our style as a constructed sheet: no <style> tag, so the page's content security rules don't get in the way
  const css = (on) => {
    if (on && !sheet) { sheet = new CSSStyleSheet(); sheet.replaceSync(${JSON.stringify(CSS)}); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; }
    if (!on && sheet) { const s = sheet; sheet = null; document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== s); }
  };
  const mark = (el) => {
    el.setAttribute('data-hex-cinema', '');
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) e.setAttribute('data-hex-cin-anc', '');
    css(true);
  };
  const thumbs = new WeakMap();
  const thumb = (x) => {
    const old = thumbs.get(x);
    if (old && Date.now() - old.at < 3000) return old.url;
    let url = null;
    try {
      if (x.readyState >= 2 && x.videoWidth) {
        const c = document.createElement('canvas'); c.width = 112; c.height = Math.round(112 * x.videoHeight / x.videoWidth) || 63;
        c.getContext('2d').drawImage(x, 0, 0, c.width, c.height); url = c.toDataURL('image/jpeg', 0.6);
      }
    } catch { url = null; } // a video from another site can't be drawn: no picture, that's all
    thumbs.set(x, { at: Date.now(), url });
    return url;
  };
  window.__hexCin = {
    list() {
      return all().map((x, i) => {
        const r = x.getBoundingClientRect(), src = x.currentSrc || x.src || '';
        return { i, src, w: x.videoWidth, h: x.videoHeight, d: Number.isFinite(x.duration) ? x.duration : 0, t: x.currentTime,
          paused: x.paused, ready: x.readyState, shown: r.width * r.height > 0, thumb: thumb(x) };
      }).filter((x) => x.src || x.ready > 0); // unloaded / emptied videos don't count
    },
    find(src, i) { const vs = all(); const k = src ? vs.findIndex((x) => (x.currentSrc || x.src) === src) : -1; return k >= 0 ? k : (vs[i] && (vs[i].readyState > 0 || vs[i].currentSrc) ? i : -1); },
    start(i) {
      v = all()[i];
      if (!v) return false;
      was = !v.paused;
      mark(v);
      v.addEventListener('ratechange', keepRate);
      clearInterval(loopT);
      loopT = setInterval(() => { if (a != null && b != null && b > a && v.currentTime >= b) v.currentTime = a; }, 50);
      return true;
    },
    // in a page holding the player: show only the frame the video plays in (found by address, else by position)
    markFrame(url, k) {
      const fs = [...document.querySelectorAll('iframe, frame')];
      const key = (u) => { try { const x = new URL(u, location.href); return x.origin + x.pathname; } catch { return ''; } };
      const f = fs.find((x) => x.src && key(x.src) === key(url)) || fs[k]
        || fs.slice().sort((p, q) => { const r = (e) => { const b = e.getBoundingClientRect(); return b.width * b.height; }; return r(q) - r(p); })[0];
      if (!f) return false;
      mark(f);
      return true;
    },
    // a player that hasn't loaded anything yet waits for its own ▶ (or a "resume?" prompt): press it for you
    kick() {
      if (!v || v.readyState > 0 || kicking) return false;
      const SEL = ['.btn-play', '.vjs-big-play-button', '.jw-display-icon-display', '.plyr__control--overlaid', '[class*="big-play"]',
        '.play-pause-center', 'button[aria-label*="play" i]', 'button[title*="play" i]', 'button[class*="play" i]', '.resume-btn.primary'];
      kicking = true;
      (async () => { // one control at a time, until the video really starts loading
        for (const s of SEL) {
          if (!v || v.readyState > 0) break;
          const e = document.querySelector(s);
          if (!e) continue;
          e.click();
          for (let k = 0; k < 15 && v && v.readyState === 0; k++) await new Promise((r) => setTimeout(r, 100));
        }
        kicking = false;
        if (v && was && v.paused) v.play().catch(() => {});
      })();
      return true;
    },
    // moving a tab between windows hides it for a moment and Chromium pauses (muted) hidden videos: carry on
    resume() { if (v && was && v.paused) v.play().catch(() => {}); return true; },
    pause(i) { const x = all()[i]; if (x) x.pause(); return true; },
    at(t, play) { if (!v) return false; if (t > 0) v.currentTime = t; was = !!play; if (play) { window.__hexCin.kick(); v.play().catch(() => {}); } else v.pause(); return true; },
    // the stream playlists (.m3u8) this frame loaded — what Cinema's ⤓ can save as one file
    streams() {
      const s = new Set();
      try { for (const e of performance.getEntriesByType('resource')) if (/[.]m3u8([?#]|$)/i.test(e.name)) s.add(e.name); } catch {}
      const src = (v && (v.currentSrc || v.src)) || '';
      if (/[.]m3u8/i.test(src)) s.add(src);
      return [...s];
    },
    state() {
      if (!v || !v.isConnected) return { gone: true };
      const src = v.currentSrc || v.src || '';
      return { t: v.currentTime, d: Number.isFinite(v.duration) ? v.duration : 0, paused: v.paused, rate: v.playbackRate,
        vol: audio ? audio.gain.gain.value * (v.muted ? 0 : 1) : (v.muted ? 0 : v.volume), w: v.videoWidth, h: v.videoHeight,
        a, b, src, file: /^https?:/.test(src) && !/[.]m3u8/i.test(src) ? src : '', streams: /^https?:/.test(src) && !/[.]m3u8/i.test(src) ? [] : window.__hexCin.streams() };
    },
    cmd(c, x) {
      if (!v) return { error: 'No video' };
      switch (c) {
        case 'play': if (v.paused) { window.__hexCin.kick(); v.play().catch(() => {}); } else v.pause(); break;
        case 'seek': v.currentTime = Math.max(0, Math.min(Number(x) || 0, v.duration || 1e9)); break;
        case 'skip': v.currentTime = Math.max(0, v.currentTime + (Number(x) || 0)); break;
        case 'frame': v.pause(); v.currentTime = Math.max(0, v.currentTime + (Number(x) || 0) / 30); break;
        case 'rate': want = Math.max(0.0625, Math.min(16, Number(x) || 1)); v.playbackRate = want; break;
        case 'vol': {
          const n = Math.max(0, Math.min(4, Number(x) || 0));
          v.muted = n === 0;
          if (n <= 1) { if (audio) audio.gain.gain.value = 1; if (n) v.volume = n; break; }
          if (!audio) {
            if (!boostOk()) return { error: 'This site blocks the volume boost (video from another site)' };
            const ctx = new AudioContext(), src = ctx.createMediaElementSource(v), gain = ctx.createGain();
            src.connect(gain).connect(ctx.destination); audio = { ctx, gain };
          }
          audio.ctx.resume().catch(() => {});
          v.volume = 1; audio.gain.gain.value = n; break;
        }
        case 'a': a = a == null ? v.currentTime : null; if (a == null) b = null; break;
        case 'b': b = b == null && a != null ? Math.max(v.currentTime, a + 0.2) : null; break;
        default: return { error: 'Unknown' };
      }
      return { ok: true };
    },
    stop() {
      clearInterval(loopT);
      if (v) v.removeEventListener('ratechange', keepRate);
      for (const e of document.querySelectorAll('[data-hex-cinema], [data-hex-cin-anc]')) { e.removeAttribute('data-hex-cinema'); e.removeAttribute('data-hex-cin-anc'); }
      css(false);
      if (audio) audio.gain.gain.value = 1; // the boost (if used) stays wired at 1×: the page sounds as before
      want = 0; a = b = null; v = null;
      return true;
    },
  };
  return true;
})()`;

let cin = null;
// { base, overlay, win, tab, phase: 'list'|'loading'|'play', mode, pick: { fid, furl, i, src }, view (page shown),
//   wc (its webContents), vf (the frame the video plays in), marked (frames we styled), copy, off, note }
let saving = null;   // a stream being saved: { job, cancel, name }
let saveNote = '';   // its last result, shown once in Cinema
let queue = Promise.resolve();
const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
const isWeb = (url) => /^(https?|file):/i.test(url || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pageKey = (u) => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return ''; } };

// ---------- running the helper in a frame ----------
// The top page: straight into its isolated world. An embedded frame: through its Cinema preload.
// A frame that goes away (or hangs) answers null instead of never.
const pending = new Map();
let seq = 0;
ipcMain.on('hex-cin:ret', (e, id, res) => {
  const p = pending.get(id);
  if (!p || e.senderFrame?.frameTreeNodeId !== p.fid) return;
  pending.delete(id);
  clearTimeout(p.timer);
  if (res && res.ok) p.resolve(res.r); else p.reject(new Error(res?.e || 'failed'));
});

function run(frame, expr, gesture = false, timeout = 8000) {
  if (!frame || frame.detached) return Promise.resolve(null);
  const code = `${HELPER}; ${expr}`;
  if (!frame.parent) {
    const { webContents } = require('electron');
    const wc = webContents.fromFrame(frame);
    if (!wc || wc.isDestroyed()) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const gone = () => resolve(null);
      const timer = setTimeout(gone, timeout);
      wc.once('destroyed', gone);
      wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }], gesture).then(resolve, reject)
        .finally(() => { clearTimeout(timer); if (!wc.isDestroyed()) wc.off('destroyed', gone); });
    });
  }
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); resolve(null); }, timeout);
    pending.set(id, { resolve, reject, timer, fid: frame.frameTreeNodeId });
    try { frame.send('hex-cin:run', id, code, gesture); } catch { clearTimeout(timer); pending.delete(id); resolve(null); }
  });
}

const framesOf = (wc) => (wc && !wc.isDestroyed() ? wc.mainFrame.framesInSubtree.filter((f) => !f.detached && isWeb(f.url)) : []);
const frameById = (wc, fid) => framesOf(wc).find((f) => f.frameTreeNodeId === fid) || null;

// every video of the page, in every frame
async function listAll(wc) {
  const frames = framesOf(wc);
  const res = await Promise.all(frames.map((f) => run(f, 'window.__hexCin.list()', false, 2500).catch(() => null)));
  return frames.flatMap((f, k) => (Array.isArray(res[k]) ? res[k] : []).map((v) => {
    let host = ''; try { host = new URL(f.url).hostname; } catch {}
    return { ...v, fid: f.frameTreeNodeId, furl: f.url, inFrame: !!f.parent, frameHost: host };
  }));
}

// show the video full-window: the video in its frame, and the frame in each page above it
async function markChain(frame, i) {
  if (!(await run(frame, `window.__hexCin.start(${i})`))) return null;
  const marked = [frame];
  for (let child = frame; child.parent; child = child.parent) {
    const parent = child.parent;
    const k = parent.frames.findIndex((f) => f.frameTreeNodeId === child.frameTreeNodeId);
    await run(parent, `window.__hexCin.markFrame(${JSON.stringify(child.url)}, ${k})`);
    marked.push(parent);
  }
  return marked;
}
const unmark = (frames) => Promise.all((frames || []).map((f) => run(f, 'window.__hexCin.stop()').catch(() => {})));

// ---------- the window ----------
function fit() {
  if (!cin || cin.base.isDestroyed()) return;
  const [w, h] = cin.base.getContentSize();
  const full = { x: 0, y: 0, width: w, height: h };
  if (cin.view && !cin.view.webContents.isDestroyed()) cin.view.setBounds(full);
  cin.overlay.setBounds(full);
}

function show(view) { // put a page under the controls
  const cv = cin.base.contentView;
  cv.addChildView(view);
  cv.addChildView(cin.overlay); // controls stay on top
  cin.view = view;
  fit();
}

function sizeTo(w, h) {
  if (!w || !h) return;
  const ratio = w / h, [cw] = cin.base.getContentSize();
  cin.base.setAspectRatio(ratio);
  cin.base.setContentSize(cw, Math.round(cw / ratio));
}

// Every Rove session gets the frame preload (so videos inside embedded players work too).
const attached = new WeakSet();
function attach(ses) {
  if (attached.has(ses)) return;
  attached.add(ses);
  ses.registerPreloadScript({ type: 'frame', filePath: FRAME_PRELOAD });
}

async function open(win, tab) {
  if (cin && !cin.base.isDestroyed()) {
    if (cin.tab === tab) { cin.base.focus(); return { message: 'Cinema is already open' }; }
    await close();
  }
  if (!tab) throw new Error('No tab here');
  const { BaseWindow, WebContentsView, screen } = require('electron');
  const { lockUiView, UI_PREFS } = require('../window');
  const W = 560, H = 315;
  const wa = screen.getDisplayMatching(win.base.getBounds()).workArea;
  const base = new BaseWindow({ width: W, height: H, x: wa.x + wa.width - W - 24, y: wa.y + wa.height - H - 24, minWidth: 260, minHeight: 150,
    frame: false, resizable: true, minimizable: false, fullscreenable: false, hasShadow: true, backgroundColor: '#0d0a16',
    alwaysOnTop: true, show: false, title: 'Cinema' });
  base.setAlwaysOnTop(true, 'floating');
  base.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); // keeps the Dock icon
  const overlay = new WebContentsView({ webPreferences: UI_PREFS });
  overlay.setBackgroundColor('#00000000');
  lockUiView(overlay.webContents, 'pb://hex/cinema.html');
  overlay.webContents.loadURL('pb://hex/cinema.html');
  base.contentView.addChildView(overlay);
  overlay.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.meta || input.control) && input.key.toLowerCase() === 'w') { e.preventDefault(); close(); }
  });
  overlay.webContents.once('did-finish-load', () => { if (!base.isDestroyed()) overlay.webContents.focus(); });
  cin = { base, overlay, win, tab, phase: 'list', mode: null, pick: null, view: null, wc: null, vf: null, marked: null, copy: null, note: '' };
  fit();
  base.on('resize', fit);
  base.on('closed', () => { if (cin && cin.base === base) close(); });
  base.show();

  // the source tab: closing it ends Cinema; a new page there refreshes the list (and gives an extracted tab back)
  const twc = tab.wc;
  if (twc) {
    const gone = () => close();
    const nav = (e) => { if (e.isMainFrame && !e.isSameDocument && cin?.mode === 'extract') serial(() => toList('The page changed — pick a video again')); };
    twc.once('destroyed', gone);
    twc.on('did-start-navigation', nav);
    cin.off = () => { twc.off('destroyed', gone); twc.off('did-start-navigation', nav); };
  }
  return { message: 'Cinema open' };
}

// Leave the current mode and go back to the list.
async function leave({ resume = true } = {}) {
  const c = cin;
  if (!c || !c.mode) return;
  const { mode, vf, marked, tab } = c;
  const win = tab.win; // (the tab may have moved to another Rove window meanwhile)
  c.mode = null; c.phase = 'list'; c.view = null; c.wc = null; c.vf = null; c.marked = null;
  if (!c.base.isDestroyed()) c.base.setAspectRatio(0);
  if (mode === 'extract') {
    tab.cinema = false;
    if (!win.destroyed) { win.stack(); tab.changed(); } // the tab goes back where it was
    try { if (!c.base.isDestroyed() && tab.view && c.base.contentView.children.includes(tab.view)) c.base.contentView.removeChildView(tab.view); } catch {}
    if (resume && win.active === tab) await run(vf, 'window.__hexCin.resume()').catch(() => {});
    await unmark(marked);
  } else if (mode === 'duplicate' && c.copy) {
    const copy = c.copy; c.copy = null;
    try { if (!c.base.isDestroyed()) c.base.contentView.removeChildView(copy); } catch {}
    if (!copy.webContents.isDestroyed()) copy.webContents.close();
  }
}

// A Duplicate still loading is dropped at once when you ask for something else (no waiting behind it).
function abortLoading() {
  const c = cin;
  if (!c || c.phase !== 'loading' || !c.copy) return;
  const copy = c.copy;
  c.copy = null; c.mode = null; c.phase = 'list'; c.view = null; c.wc = null;
  try { if (!c.base.isDestroyed()) c.base.contentView.removeChildView(copy); } catch {}
  if (!copy.webContents.isDestroyed()) copy.webContents.close();
}

async function toList(note = '') { await leave(); if (cin) cin.note = note; }

// keep the chosen speed and volume when switching modes
async function carry(frame, at) {
  if (at?.rate && Math.abs(at.rate - 1) > 1e-3) await run(frame, `window.__hexCin.cmd('rate', ${Number(at.rate)})`, true);
  if (at?.vol != null && Math.abs(at.vol - 1) > 1e-3) await run(frame, `window.__hexCin.cmd('vol', ${Number(at.vol)})`, true);
}

// Show video { fid, i } of the tab in Cinema, as 'extract' or 'duplicate'. `at` = { t, play, rate, vol } carries the moment over.
async function pick(key, mode, at = null) {
  const c = cin;
  if (!c) throw new Error('Cinema is closed');
  const { tab } = c;
  const win = tab.win;
  const twc = tab.wc;
  if (!twc || !isWeb(twc.getURL())) throw new Error('Cinema works on web pages');
  const frame = frameById(twc, key.fid);
  const list = frame ? (await run(frame, 'window.__hexCin.list()')) || [] : [];
  const item = list.find((x) => x.i === key.i);
  if (!item) throw new Error('That video is gone');
  await leave({ resume: mode === 'extract' });
  c.pick = { fid: key.fid, furl: frame.url, inFrame: !!frame.parent, i: key.i, src: item.src };
  c.note = '';
  const from = at || { t: item.t, play: true };

  if (mode === 'extract') {
    const marked = await markChain(frame, key.i);
    if (!marked) throw new Error('That video is gone');
    show(tab.view); // into Cinema first (never hidden on the way), then out of Rove's window
    tab.cinema = true;
    win.stack();
    tab.changed(); // Rove shows "Playing in Cinema" where the page was
    Object.assign(c, { mode: 'extract', wc: twc, vf: frame, marked, phase: 'play' });
    await run(frame, `window.__hexCin.at(${at ? Number(at.t) || 0 : 0}, ${!!from.play})`, true);
    await run(frame, 'window.__hexCin.resume()');
    await carry(frame, at);
    sizeTo(item.w, item.h);
    return { ok: true };
  }

  // Duplicate: our own copy of the page, same session (so logins work), no Rove bridge, no popups.
  const { WebContentsView } = require('electron');
  const copy = new WebContentsView({ webPreferences: { session: twc.session, contextIsolation: true, sandbox: true,
    nodeIntegration: false, nodeIntegrationInSubFrames: true, backgroundThrottling: false, safeDialogs: true } });
  copy.setBackgroundColor('#000000');
  copy.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  copy.webContents.setAudioMuted(true); // silent until it shows the right video at the right moment
  Object.assign(c, { copy, mode: 'duplicate', phase: 'loading', wc: copy.webContents });
  show(copy);
  await run(frame, `window.__hexCin.pause(${key.i})`); // the original stops, so you don't hear it twice
  copy.webContents.loadURL(twc.getURL()).catch(() => {});
  // wait for the same video in the copy: in the frame with the same address (or the page), same source or position
  const deadline = Date.now() + 20000;
  let found = null;
  while (cin === c && c.copy === copy && Date.now() < deadline) {
    const frames = framesOf(copy.webContents).filter((f) => (c.pick.inFrame ? !!f.parent && pageKey(f.url) === pageKey(c.pick.furl) : !f.parent));
    for (const f of frames) {
      const k = await run(f, `window.__hexCin.find(${JSON.stringify(item.src)}, ${key.i})`, false, 2500).catch(() => -1);
      if (k != null && k >= 0) { found = { f, k }; break; }
    }
    if (found) break;
    await sleep(300);
  }
  if (cin !== c || c.copy !== copy) return { ok: false }; // closed or changed meanwhile
  if (!found) { await toList('Couldn’t find that video in the copy — try Extract'); return { error: 'Couldn’t find that video in the copy — try Extract' }; }
  const marked = await markChain(found.f, found.k);
  Object.assign(c, { vf: found.f, marked });
  await run(found.f, `window.__hexCin.at(${Number(from.t) || 0}, ${!!from.play})`, true);
  await carry(found.f, at);
  copy.webContents.setAudioMuted(false);
  c.phase = 'play';
  copy.webContents.on('did-start-navigation', (e) => { if (e.isMainFrame && !e.isSameDocument && cin?.copy === copy && cin.phase === 'play') serial(() => toList('The copy left the page — pick a video again')); });
  sizeTo(item.w, item.h);
  return { ok: true };
}

async function swap() {
  const c = cin;
  if (!c || c.phase !== 'play' || !c.pick) throw new Error('Pick a video first');
  const s = (await run(c.vf, 'window.__hexCin.state()')) || {};
  const twc = c.tab.wc;
  // the same video in the tab again (the copy's numbering can differ)
  const frame = frameById(twc, c.pick.fid) || framesOf(twc).find((f) => pageKey(f.url) === pageKey(c.pick.furl));
  const i = frame ? (await run(frame, `window.__hexCin.find(${JSON.stringify(c.pick.src)}, ${c.pick.i})`)) ?? -1 : -1;
  if (i < 0) throw new Error('That video is gone from the page');
  return pick({ fid: frame.frameTreeNodeId, i }, c.mode === 'extract' ? 'duplicate' : 'extract', { t: s.t || 0, play: s.paused === false, rate: s.rate, vol: s.vol });
}

async function close() {
  const c = cin;
  if (!c) return;
  await leave().catch(() => {});
  if (cin !== c) return;
  cin = null;
  c.off?.();
  if (!c.overlay.webContents.isDestroyed()) c.overlay.webContents.close();
  if (!c.base.isDestroyed()) c.base.destroy();
}

async function state() {
  const c = cin;
  const common = { phase: c.phase, mode: c.mode, pinned: c.base.isAlwaysOnTop(), opacity: c.base.getOpacity(), title: c.tab.title || '', note: c.note,
    saving: saving ? (saving.job.total ? Math.floor((saving.job.done / saving.job.total) * 100) : 0) : null, saveNote };
  if (c.phase === 'play') {
    const s = c.vf && !c.vf.detached ? await run(c.vf, 'window.__hexCin.state()') : { gone: true };
    if (s?.gone) { serial(() => (cin === c && c.phase === 'play' ? toList('The video went away — pick another') : null)); return { ...common, phase: 'list', videos: [] }; }
    return { ...common, ...s, stream: !!s?.streams?.length, streams: undefined };
  }
  if (c.phase === 'loading') return common;
  const twc = c.tab.wc;
  if (!twc || !isWeb(twc.getURL())) return { ...common, videos: [], web: false };
  return { ...common, web: true, videos: await listAll(twc).catch(() => []) };
}

// ⤓ on a streamed video: join the stream's pieces into one file in Downloads (open streams only).
async function saveStream(candidates) {
  const dl = require('../downloads');
  const { app } = require('electron');
  const c = cin;
  const win = c.tab.win;
  saveNote = '';
  saving = await require('./streamsave').save({ ses: c.tab.wc.session, candidates, referer: c.vf.url, title: c.tab.title,
    dir: dl.folder(), uniquePath: dl.uniquePath });
  saving.promise.then(({ files }) => {
    saveNote = `Saved to Downloads: ${path.basename(files[0])}${files[1] ? ' (+ its sound as a separate file)' : ''}`;
    if (process.platform === 'darwin') app.dock?.downloadFinished(files[0]);
    if (!win.destroyed) win.showToast?.(saveNote, 6000);
  }, (err) => {
    saveNote = err.message === 'cancelled' ? 'Saving stopped' : `Can’t save: ${err.message}`;
  }).finally(() => { saving = null; setTimeout(() => { if (!saving) saveNote = ''; }, 5000); });
  return { ok: true, message: 'Saving the stream to Downloads…' };
}

function setup(core) {
  const only = (channel, fn) => ipcMain.handle(channel, async (e, ...args) => {
    if (!cin) return { error: 'closed' }; // a last poll from controls that are closing
    if (e.sender !== cin.overlay.webContents) throw new Error('not allowed');
    try { return await fn(...args); } catch (err) { return { error: String(err && err.message || err) }; }
  });
  only('cin:state', () => state());
  const CMDS = new Set(['play', 'seek', 'skip', 'frame', 'rate', 'vol', 'a', 'b']);
  only('cin:cmd', async (c, x, y) => {
    if (CMDS.has(c)) {
      if (cin.phase !== 'play') return { error: 'Pick a video first' };
      return run(cin.vf, `window.__hexCin.cmd(${JSON.stringify(c)}, ${JSON.stringify(Number(x) || 0)})`, true);
    }
    if (['pick', 'swap', 'list'].includes(c)) abortLoading();
    if (c === 'pick') {
      const key = { fid: Math.floor(Number(x?.fid) || 0), i: Math.max(0, Math.floor(Number(x?.i) || 0)) };
      const m = y === 'duplicate' ? 'duplicate' : 'extract';
      return serial(() => pick(key, m));
    }
    if (c === 'swap') return serial(swap);
    if (c === 'list') { await serial(() => toList()); return { ok: true }; }
    if (c === 'pin') { cin.base.setAlwaysOnTop(!cin.base.isAlwaysOnTop(), 'floating'); return { ok: true }; }
    if (c === 'opacity') { cin.base.setOpacity(Math.max(0.2, Math.min(1, Number(x) || 1))); return { ok: true }; }
    if (c === 'close') { setImmediate(close); return { ok: true }; } // reply first: this very view goes away
    if (c === 'download') {
      if (saving) { saving.cancel(); return { ok: true, message: 'Stopping…' }; }
      const s = cin.phase === 'play' ? await run(cin.vf, 'window.__hexCin.state()') : null;
      if (s?.file) { cin.tab.wc.downloadURL(s.file); return { ok: true, message: 'Saving to Downloads…' }; }
      if (!s?.streams?.length) return { error: 'No video file or open stream to save here' };
      return saveStream(s.streams);
    }
    return { error: 'Unknown' };
  });

  core.register({ id: 'magic.cinema', family: 'magic', icon: 'cinema', name: 'Cinema',
    description: 'A window on top for the page’s videos', run: ({ win, tab }) => open(win, tab) });
}

// From Rove's "Playing in Cinema" placeholder: bring the tab back, or keep watching as a Duplicate.
async function fromRove(win, action) {
  if (!cin || cin.mode !== 'extract' || cin.tab.win !== win) return;
  abortLoading();
  if (action === 'back') await serial(() => toList());
  else if (action === 'duplicate') await serial(swap).catch(() => {});
  else if (action === 'show') cin.base.focus();
}

module.exports = { setup, attach, open, close, pick, swap, fromRove, current: () => cin, _helper: HELPER };
