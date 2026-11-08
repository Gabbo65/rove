// Test runner: boots the REAL app (throwaway profile, local test web server), then runs test/specs/*.test.js.
//   npm test                 → everything
//   npm test -- favorites    → only specs whose file or test name contains "favorites"
//   npm run test:compact     → only the tests listed in test/compact.txt (quick check while working)
const { app, webContents, nativeImage, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert/strict');

process.env.PB_TEST = '1';
process.env.PB_PORT = '0'; // random port for the phone server: never clashes with your running browser

const filter = (process.argv.slice(2).find((a) => !a.startsWith('-') && !a.endsWith('.js') && a !== '.') || '').toLowerCase();
// Compact list: one line per pick, "file" (whole spec file) or "file > test name" (one test); both are
// case-insensitive "contains" matches. Blank lines and # comments are ignored.
const compact = process.argv.includes('--compact')
  ? fs.readFileSync(path.join(__dirname, 'compact.txt'), 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)
    .map((l) => { const [f, n = ''] = l.split('>').map((x) => x.trim().toLowerCase()); return { f, n }; })
  : null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-test-'));
app.setPath('userData', path.join(tmp, 'profile'));
app.setPath('downloads', path.join(tmp, 'Downloads'));
fs.mkdirSync(path.join(tmp, 'Downloads'), { recursive: true });

const fixtures = require('./fixtures/server');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, { timeout = 8000, interval = 50, message = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${message}${last instanceof Error ? ` (${last.message})` : ''}`);
}

let fixtureServer = null;

app.once('pb-ready', async (hub) => {
  const { server, base } = await fixtures.start();
  fixtureServer = server;

  const t = {
    hub, app, assert, sleep, until, base, tmp,
    url: (p) => base + p,
    win: () => hub.current(),
    db: () => require('../src/main/db').get(),
    settings: require('../src/main/settings'),
    // Run JS in the window's toolbar UI
    ui: (code, win = hub.current()) => win.chrome.webContents.executeJavaScript(code),
    hudJs: (code, win = hub.current()) => win.hud.webContents.executeJavaScript(code),
    // Run JS in a tab's page (userGesture so fullscreen etc. are allowed)
    page: (code, tab = hub.current().active) => tab.wc.executeJavaScript(code, true),
    // Load a URL in the active tab and wait for it to finish
    async go(input, win = hub.current()) {
      const tab = win.active;
      const stopped = tab.wc ? new Promise((r) => tab.wc.once('did-stop-loading', r)) : Promise.resolve();
      win.navigate(input);
      await Promise.race([stopped, sleep(10000)]);
      await until(() => !tab.loading && tab.wc && !tab.wc.isLoading(), { message: `load ${input}` });
      return tab;
    },
    async loaded(tab) { await until(() => tab.wc && !tab.wc.isLoading() && !tab.loading, { message: 'tab load' }); return tab; },
    // A fresh window with one New Tab (everything else closed), and an empty closed-tabs stack.
    async fresh(opts = {}) {
      for (const w of hub.all()) { w.closing = true; w.base.close(); }
      await until(() => hub.all().length === 0, { message: 'windows closed' });
      t.db().exec('DELETE FROM closed_actions');
      const w = hub.create(opts);
      await until(() => w.uiReady, { message: 'window UI ready' });
      await until(() => w.active?.wc && !w.active.wc.isLoading(), { message: 'new tab ready' });
      return w;
    },
    // Real mouse drag inside the toolbar UI: press at `from`, move through `path`, release. Returns the dragged
    // element's box (and its row's box) seen at each step.
    async mouseDrag(from, path, selector, win = hub.current()) {
      const wc = win.chrome.webContents;
      const send = (type, x, y) => wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1,
        modifiers: type === 'mouseMove' ? ['leftButtonDown'] : [] });
      send('mouseMove', from.x, from.y); send('mouseDown', from.x, from.y);
      await sleep(30);
      // Like the real app: activating a tab focuses its page, so this view loses focus mid-press.
      await wc.executeJavaScript(`window.dispatchEvent(new Event('blur'))`);
      const seen = [];
      for (const p of path) {
        send('mouseMove', p.x, p.y);
        await sleep(30);
        seen.push(await wc.executeJavaScript(`(() => { const el = document.querySelector('${selector}.hdragging');
          if (!el) return null; const r = el.getBoundingClientRect(), c = el.parentElement.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, rowLeft: c.left, rowRight: c.right }; })()`));
      }
      const end = path[path.length - 1];
      send('mouseUp', end.x, end.y);
      await sleep(50);
      return seen;
    },
    // Screenshot of what the window shows (page + UI + hud), for visual checks.
    async snapshot(name, win = hub.current()) {
      const [w, h] = win.base.getContentSize();
      const parts = [];
      const grab = async (view, rect) => { try { const img = await view.webContents.capturePage(); if (!img.isEmpty()) parts.push({ url: img.toDataURL(), rect }); } catch {} };
      const wasOverlay = win.overlay;
      if (win.active?.view) await grab(win.active.view, win.active.view.getBounds());
      // Same order as the real window: hud under the UI while a popup is open, above it otherwise.
      if (wasOverlay && win.hudSize.width) await grab(win.hud, win.hud.getBounds());
      win.overlay = true; win.stack();           // UI on top to capture it (transparent over the page)
      await sleep(80);
      await grab(win.chrome, { x: 0, y: 0, width: w, height: h });
      win.overlay = wasOverlay; win.stack();
      if (!wasOverlay && win.hudSize.width) await grab(win.hud, win.hud.getBounds());
      const painter = new BrowserWindow({ show: false, width: w, height: h, webPreferences: { offscreen: true } });
      await painter.loadURL('data:text/html,<canvas id=c></canvas>');
      const dataUrl = await painter.webContents.executeJavaScript(`(async () => {
        const c = document.getElementById('c'); c.width = ${w * 2}; c.height = ${h * 2};
        const g = c.getContext('2d'); g.scale(2, 2);
        g.fillStyle = '#888'; g.fillRect(0, 0, ${w}, ${h});
        for (const p of ${JSON.stringify(parts)}) {
          const img = new Image(); img.src = p.url; await img.decode();
          g.drawImage(img, p.rect.x, p.rect.y, p.rect.width, p.rect.height);
        }
        return c.toDataURL('image/png');
      })()`);
      painter.destroy();
      const file = path.join(process.env.PB_SNAPSHOTS || tmp, `${name}.png`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, nativeImage.createFromDataURL(dataUrl).toPNG());
      return file;
    },
  };

  const specDir = path.join(__dirname, 'specs');
  const files = fs.readdirSync(specDir).filter((f) => f.endsWith('.test.js')).sort();
  let passed = 0, failed = 0, skipped = 0;
  const failures = [];
  const started = Date.now();

  for (const file of files) {
    const tests = require(path.join(specDir, file));
    const fileMatch = file.toLowerCase().includes(filter);
    const chosen = tests.filter((x) => (!filter || fileMatch || x.name.toLowerCase().includes(filter))
      && (!compact || compact.some((c) => file.toLowerCase().includes(c.f) && x.name.toLowerCase().includes(c.n))));
    if (!chosen.length) continue;
    console.log(`\n${file}`);
    for (const test of chosen) {
      if (test.skip) { skipped++; console.log(`  - ${test.name} (skipped: ${test.skip})`); continue; }
      const t0 = Date.now();
      try {
        await Promise.race([test.run(t), sleep(test.timeout || 45000).then(() => { throw new Error('test timed out'); })]);
        passed++;
        console.log(`  ✓ ${test.name} (${Date.now() - t0} ms)`);
      } catch (err) {
        failed++;
        failures.push({ file, name: test.name, err });
        console.log(`  ✗ ${test.name}\n      ${String(err?.stack || err).split('\n').slice(0, 4).join('\n      ')}`);
      }
    }
  }

  if (compact && !passed && !failed) console.log('\nCompact list is empty — nothing to run (add picks to test/compact.txt).');
  console.log(`\n${compact ? '[compact] ' : ''}${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''} — ${((Date.now() - started) / 1000).toFixed(1)} s`);
  fixtureServer.close();
  for (const w of hub.all()) w.base.close();
  await sleep(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  app.exit(failed ? 1 : 0);
});

// Boot the real app.
require('../src/main/app');
