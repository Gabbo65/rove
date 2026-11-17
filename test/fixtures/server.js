// Local web server with test pages, so tests never depend on the internet.
const http = require('http');
const fs = require('fs');
const path = require('path');
const CLIP = fs.readFileSync(path.join(__dirname, 'clip.webm')); // 8 s test video (with sound) for Cinema

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const page = (title, body = '', head = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head>
<body style="font:16px sans-serif">${body}</body></html>`;

const routes = {
  '/p1': () => page('Page One', '<h1>One</h1><a id="next" href="/p2">next</a>'),
  '/p2': () => page('Page Two', '<h1>Two</h1><a id="next" href="/p3">next</a>'),
  '/p3': () => page('Page Three', '<h1>Three</h1>'),
  '/fav': () => page('With Icon', '<h1>icon</h1>', '<link rel="icon" href="/icon.png">'),
  '/long': () => page('Long Text', Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i}: the browser renders text; a browser is software.</p>`).join('')),
  '/links': () => page('Links', '<a id="blank" href="/p2" target="_blank">new tab link</a> <a id="pb" href="pb://settings/">evil</a>'),
  '/scroll': () => page('Tall', '<div style="height:5000px;background:linear-gradient(#fff,#09f)">tall</div>'),
  '/video': () => page('Video Page', '<h1>Watch</h1><div style="transform:scale(.9)"><video id="v" src="/clip.webm" width="320" muted loop></video></div><p>below</p>'),
  '/ads': () => page('Ads Page', `<h1>Content</h1><div class="ad-box" id="adbox">AD</div><script src="/ad-banner.js"></script>
    <button id="pop" onclick="window.open('/ad-popup')">ad</button><button id="ok" onclick="window.open('/p2')">ok</button>`),
  '/ad-banner.js': () => 'window.__adRan = 1;',
  '/ad-popup': () => page('Ad', '<h1>Buy now</h1>'),
  // a page embedding a frame from ANOTHER site (localhost vs 127.0.0.1) that tries to open popups, like ad video players
  '/embed': () => page('Embed', `<h1>Player page</h1><button id="top-pop" onclick="window.open('/p3')">top</button>
    <iframe id="f" style="width:400px;height:200px"></iframe>
    <script>document.getElementById('f').src = location.href.replace('127.0.0.1', 'localhost').replace('/embed', '/frame-pop');</script>`),
  '/frame-pop': () => page('Frame', `<button id="wo" onclick="window.open(location.href.replace('localhost', '127.0.0.1').replace('/frame-pop', '/p2'))">open</button>
    <button id="ac" onclick="const a = document.createElement('a'); a.href = '/p2'; a.target = '_blank'; document.body.append(a); a.click()">anchor</button>
    <a id="real" href="/p3" target="_blank">real link</a>
    <button id="topnav" onclick="top.location.href = 'http://127.0.0.2:9/ad'">replace the page</button>
    <button id="topok" onclick="top.location.href = location.href.replace('localhost', '127.0.0.1').replace('/frame-pop', '/p2')">same site</button>`),
  // a "strict popups" page: its own scripts open other sites; a real link must still work
  '/strict': () => page('Strict', `<button id="sp" onclick="window.open(location.href.replace('127.0.0.1', 'localhost').replace('/strict', '/p2'))">ad popup</button>
    <button id="same" onclick="window.open('/p3')">same site</button>
    <button id="jump" onclick="location.href = location.href.replace('127.0.0.1', 'localhost').replace('/strict', '/p2')">ad jump</button>
    <a id="lnk" target="_blank" style="display:inline-block;padding:20px">a real link</a>
    <script>document.getElementById('lnk').href = location.href.replace('127.0.0.1', 'localhost').replace('/strict', '/p3');</script>`),
  // the video lives in an embedded player from ANOTHER site (localhost vs 127.0.0.1), like streaming sites
  '/video-in-frame': () => page('Player Page', `<h1>Episode</h1><div style="transform:scale(.95)"><iframe id="pf" style="width:480px;height:270px" allow="autoplay"></iframe></div>
    <script>document.getElementById('pf').src = location.href.replace('127.0.0.1', 'localhost').replace('/video-in-frame', '/video');</script>`),
  // a page that plays through a blob (like hls.js players) and loads an HLS playlist (?locked = an encrypted one)
  '/stream': () => page('My Stream', `<h1>Stream</h1><video id="v" muted loop width="320"></video>
    <script>
      const v = document.getElementById('v'), ms = new MediaSource();
      v.src = URL.createObjectURL(ms);
      ms.addEventListener('sourceopen', async () => {
        const sb = ms.addSourceBuffer('video/webm; codecs="vp8, opus"');
        sb.mode = 'sequence';
        sb.appendBuffer(await (await fetch('/clip.webm')).arrayBuffer());
      });
      fetch(location.search.includes('locked') ? '/hls/locked.m3u8' : '/hls/master.m3u8');
    </script>`),
  // popups the way players and ad scripts make them
  '/popups': () => page('Popups', `<h1>Popups</h1><a id="away" href="/p2" target="_blank">link</a>
    <script>
      window.fill = () => { const w = window.open('about:blank'); window.__got = !!w; if (w) { w.document.title = 'Filled by opener'; w.document.body.innerHTML = '<h1 id="x">hi</h1>'; } return !!w; };
      window.loop = () => { let n = 0; for (let i = 0; i < 10; i++) if (window.open('/p' + ((i % 3) + 1))) n++; return n; };
    </script>`),
  '/fullscreen': () => page('Fullscreen', '<div id="v" style="width:300px;height:200px;background:#000"></div>'),
  '/form': () => page('Login', `<form id="login" method="post" action="/login">
      <input id="user" name="username" autocomplete="username">
      <input id="pass" name="password" type="password" autocomplete="current-password">
      <button id="go" type="submit">Sign in</button></form>`),
  '/address': () => page('Address', `<form id="addr" method="post" action="/thanks">
      <input id="name" name="name" autocomplete="name"><input id="email" name="email" type="email" autocomplete="email">
      <input id="tel" name="tel" autocomplete="tel"><input id="street" name="address" autocomplete="street-address">
      <input id="city" name="city" autocomplete="address-level2"><input id="zip" name="zip" autocomplete="postal-code">
      <button id="go" type="submit">Send</button></form>`),
  '/framed-login': () => page('Framed', '<iframe id="f" src="/form" style="width:400px;height:200px"></iframe>'),
  '/thanks': () => page('Thanks', '<h1>Thanks</h1>'),
  '/login': () => page('Logged in', '<h1>Welcome</h1>'),
};

function start() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/icon.png' || u.pathname === '/favicon.ico') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG_1PX); }
    if (u.pathname.startsWith('/hls/')) { // a local HLS stream (cut from clip.webm) for Cinema's stream saving
      if (u.pathname === '/hls/locked.m3u8') { res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); return res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:2,\nseg0.ts\n#EXT-X-ENDLIST\n'); }
      const f = path.join(__dirname, 'hls', path.basename(u.pathname));
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      if (u.pathname.endsWith('.ts') && req.headers.referer && !/\/stream/.test(req.headers.referer)) { res.writeHead(403); return res.end(); }
      res.writeHead(200, { 'Content-Type': f.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t' });
      return res.end(fs.readFileSync(f));
    }
    if (u.pathname === '/clip.webm') { // with byte ranges, so the video can seek
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      const from = m ? Number(m[1]) : 0, to = m && m[2] ? Number(m[2]) : CLIP.length - 1;
      res.writeHead(m ? 206 : 200, { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Content-Length': to - from + 1,
        ...(m ? { 'Content-Range': `bytes ${from}-${to}/${CLIP.length}` } : {}) });
      return res.end(CLIP.subarray(from, to + 1));
    }
    if (u.pathname === '/file.bin') {
      const body = Buffer.alloc(300 * 1024, 7);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length,
        'Content-Disposition': 'attachment; filename="file.bin"' });
      return res.end(body);
    }
    if (u.pathname === '/slow.bin') {
      // 2 MB at ~100 KB per 100 ms: slow enough to pause/resume/cancel
      const total = 2 * 1024 * 1024, chunk = Buffer.alloc(100 * 1024, 1);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': total,
        'Content-Disposition': 'attachment; filename="slow.bin"' });
      let sent = 0;
      const timer = setInterval(() => {
        if (res.destroyed) return clearInterval(timer);
        res.write(chunk); sent += chunk.length;
        if (sent >= total) { clearInterval(timer); res.end(); }
      }, 100);
      req.on('close', () => clearInterval(timer));
      return;
    }
    if (u.pathname === '/suggest') {
      const q = u.searchParams.get('q') || '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([q, [`${q} one`, `${q} two`, `${q} three`]]));
    }
    if (u.pathname === '/gh-latest') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const v = u.searchParams.get('v') || '0.0.1';
      return res.end(JSON.stringify({ tag_name: `v${v}`, html_url: `https://github.com/Gabbo65/rove/releases/tag/v${v}` }));
    }
    if (u.pathname === '/npm-latest') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ name: 'electron', version: u.searchParams.get('v') || '0.0.1' }));
    }
    if (u.pathname === '/cookie') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'pbtest=1; Max-Age=3600; Path=/' });
      return res.end(page('Cookie', '<h1>cookie set</h1>'));
    }
    const fn = routes[u.pathname];
    if (fn) {
      if (req.method === 'POST') { req.resume(); }
      res.writeHead(200, { 'Content-Type': u.pathname.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
      return res.end(fn(u));
    }
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(page('Not Found', '404'));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

module.exports = { start };
