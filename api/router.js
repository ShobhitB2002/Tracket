// Single Vercel function for every /api/* route (see vercel.json rewrites and
// lib/routes.js for the route table).
const { dispatch } = require('../lib/routes');

// Work out which /api/* path was requested. Depending on how Vercel applied the
// rewrite, the original path is in req.url, in the __path query param (string
// or array), or in a forwarding header.
function apiPath(req) {
  const fromUrl = new URL(req.url, 'http://x').pathname;
  if (fromUrl.startsWith('/api/') && fromUrl !== '/api/router') return fromUrl;
  let p = req.query?.__path;
  if (Array.isArray(p)) p = p.join('/');
  if (p) return '/api/' + String(p).replace(/^\/+/, '').replace(/^api\//, '');
  for (const h of ['x-matched-path', 'x-forwarded-uri', 'x-original-url']) {
    const v = req.headers[h];
    if (v && String(v).startsWith('/api/') && !String(v).startsWith('/api/router')) return new URL(v, 'http://x').pathname;
  }
  return fromUrl;
}

module.exports = async (req, res) => {
  const pathname = apiPath(req);
  const { __path, ...query } = req.query || {};
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const out = await dispatch({ method: req.method, pathname, query, body, req });
  if (out.status === 404) out.body = { error: 'not found', path: pathname, method: req.method };
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  if (out.raw !== undefined) return res.status(out.status).send(out.raw);
  res.status(out.status).json(out.body);
};
