// Which /api/* route was requested. Vercel may hand us the rewritten URL
// (/api/router?__path=me) or the original one (/api/me), and may run either
// api/router.js or server.js — so both use this.
function apiPath(rawUrl, query = {}, headers = {}) {
  const fromUrl = new URL(rawUrl, 'http://x').pathname;
  if (fromUrl.startsWith('/api/') && fromUrl !== '/api/router') return fromUrl;
  let p = query.__path;
  if (Array.isArray(p)) p = p.join('/');
  if (p) return '/api/' + String(p).replace(/^\/+/, '').replace(/^api\//, '');
  for (const h of ['x-matched-path', 'x-forwarded-uri', 'x-original-url']) {
    const v = headers[h];
    if (v && String(v).startsWith('/api/') && !String(v).startsWith('/api/router')) return new URL(v, 'http://x').pathname;
  }
  return fromUrl;
}

module.exports = { apiPath };
