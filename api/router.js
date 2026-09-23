// Single Vercel function for every /api/* route (see vercel.json rewrites and
// lib/routes.js for the route table).
const { dispatch } = require('../lib/routes');

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = '/api/' + String(req.query.__path || url.pathname.replace(/^\/api\/?/, '')).replace(/^\/+/, '');
  const { __path, ...query } = req.query || {};
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const out = await dispatch({ method: req.method, pathname, query, body, req });
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  if (out.raw !== undefined) return res.status(out.status).send(out.raw);
  res.status(out.status).json(out.body);
};
