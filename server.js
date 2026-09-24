// Local server: the same routes as the Vercel function (lib/routes.js), plus
// static files from public/. Zero dependencies, Node 18+.
//   npm start  →  http://localhost:3000   (admin panel: /admin)
const http = require('http');
const fs = require('fs');
const path = require('path');

loadEnv(path.join(__dirname, '.env'));

const { dispatch } = require('./lib/routes');
const { apiPath } = require('./lib/apipath');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch {}
    const { __path, ...query } = Object.fromEntries(url.searchParams);
    const pathname = apiPath(req.url, Object.fromEntries(url.searchParams), req.headers);
    const out = await dispatch({ method: req.method, pathname, query, body, req });
    if (out.status === 404) out.body = { error: 'not found', path: pathname };
    const headers = { 'Cache-Control': 'no-store', ...(out.raw === undefined ? { 'Content-Type': 'application/json' } : {}), ...out.headers };
    res.writeHead(out.status, headers);
    return res.end(out.raw !== undefined ? out.raw : JSON.stringify(out.body));
  }

  const rel = url.pathname === '/' ? 'index.html' : url.pathname === '/admin' ? 'admin.html' : path.normalize(url.pathname);
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, process.env.VERCEL ? undefined : '127.0.0.1', () => {
  console.log(`\n  ⏱  Tracket →  http://localhost:${PORT}   ·   admin → http://localhost:${PORT}/admin\n`);
  if (!process.env.ADMIN_PASSWORD) console.log('  ⚠  ADMIN_PASSWORD is empty — set it in .env to use the admin panel\n');
});
