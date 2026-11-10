// pb:// — our own scheme for the browser UI and built-in pages (like edge:// or chrome://).
// pb://chrome  → window UI         pb://hud → find bar + QR overlay
// pb://newtab, pb://history, pb://settings, pb://error → pages that open in tabs
// pb://shared  → CSS/JS shared by the above
const { protocol } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { UI } = require('./paths');

const HOSTS = {
  chrome: 'chrome', hud: 'hud', shared: 'shared', streamer: 'streamer',
  newtab: 'pages/newtab', history: 'pages/history', settings: 'pages/settings', error: 'pages/error',
};

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
};

// Must run before app 'ready'.
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'pb',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
  }]);
}

async function handler(request) {
  let url;
  try { url = new URL(request.url); } catch { return new Response('Bad request', { status: 400 }); }
  if (url.hostname === 'shared' && url.pathname === '/look.css') { // generated from the Appearance settings
    return new Response(require('./look').css(undefined, { custom: url.searchParams.get('custom') !== '0' }), { status: 200, headers: { 'Content-Type': TYPES['.css'], 'Cache-Control': 'no-store' } });
  }
  if (url.hostname === 'shared' && url.pathname === '/newtab-bg') { // your New Tab background picture
    const bg = require('./newtab-bg').current();
    if (!bg) return new Response('Not found', { status: 404 });
    try { return new Response(await fs.readFile(bg.file), { status: 200, headers: { 'Content-Type': bg.type, 'Cache-Control': 'no-cache' } }); }
    catch { return new Response('Not found', { status: 404 }); }
  }
  const dir = HOSTS[url.hostname];
  if (!dir) return new Response('Not found', { status: 404 });
  const root = path.join(UI, dir);
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) && file !== root) return new Response('Forbidden', { status: 403 });
  try {
    const body = await fs.readFile(file);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'X-Frame-Options': 'DENY', // no web page may embed our pages
        'Cache-Control': 'no-cache',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

// Each session (normal + every private window) needs the handler.
const handled = new WeakSet();
function handleSession(ses) {
  if (handled.has(ses)) return;
  handled.add(ses);
  ses.protocol.handle('pb', handler);
}

module.exports = { registerScheme, handleSession };
