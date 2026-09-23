// Wraps a core handler for Vercel's (req, res) functions, with auth.
const auth = require('./auth');

function vercel(handler, { methods = ['GET'], open = false } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!methods.includes(req.method)) return res.status(405).json({ error: 'method not allowed' });
    if (!open) {
      const denied = auth.check(req);
      if (denied) return res.status(denied.status).json(denied.body);
    }
    try {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const out = await handler({ query: req.query || {}, body: body || {}, headers: req.headers, req });
      for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
      res.status(out.status).json(out.body);
    } catch (e) {
      res.status(e.status === 401 ? 401 : e.status || 500).json({ error: e.message });
    }
  };
}

module.exports = { vercel };
