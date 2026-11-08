// Local web server with test pages, so tests never depend on the internet.
const http = require('http');

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
    if (u.pathname === '/icon.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG_1PX); }
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
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fn(u));
    }
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(page('Not Found', '404'));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

module.exports = { start };
