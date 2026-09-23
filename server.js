// Local server: same handlers as the Vercel functions in api/, plus static
// files from public/. Zero dependencies, Node 18+.
//   npm start  →  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');

loadEnv(path.join(__dirname, '.env'));

const auth = require('./lib/auth');
const core = require('./lib/core');
const { handleLogin } = require('./lib/login');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');

const routes = {
  'GET /api/today': core.handleToday,
  'GET /api/live': core.handleLive,
  'POST /api/event': core.handleEvent,
  'DELETE /api/running': core.handleClearRunning,
  'POST /api/login': handleLogin,
};
const OPEN = new Set(['POST /api/login']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = `${req.method} ${url.pathname}`;
  const handler = routes[key];

  if (handler) {
    if (!OPEN.has(key)) {
      const denied = auth.check(req);
      if (denied) return json(res, denied.status, denied.body);
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch {}
    try {
      const out = await handler({ query: Object.fromEntries(url.searchParams), body, headers: req.headers, req });
      return json(res, out.status, out.body, out.headers);
    } catch (e) {
      return json(res, e.status || 500, { error: e.message });
    }
  }
  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });

  const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  ⏱  Tracket →  http://localhost:${PORT}\n`);
  if (!process.env.ASANA_PAT) console.log('  ⚠  ASANA_PAT is empty — copy .env.example to .env and add your token\n');
});
