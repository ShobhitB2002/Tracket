// One shared secret (TRACKET_SECRET) protects everything:
// - the dashboard logs in once and gets an HttpOnly cookie
// - the userscript sends it as the `x-tracket-key` header
// Running locally without a secret is allowed (it only listens on 127.0.0.1).
const crypto = require('crypto');

const secret = () => (process.env.TRACKET_SECRET || '').trim();
const cookieValue = () => crypto.createHash('sha256').update('tracket:' + secret()).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

// Returns null when allowed, or an error {status, body}.
function check(req) {
  const s = secret();
  if (!s) {
    if (process.env.VERCEL) return { status: 500, body: { error: 'Set TRACKET_SECRET in your Vercel environment variables, then redeploy.' } };
    return null;
  }
  const key = req.headers['x-tracket-key'];
  if (key && safeEqual(key, s)) return null;
  const c = readCookie(req, 'tracket');
  if (c && safeEqual(c, cookieValue())) return null;
  return { status: 401, body: { error: 'locked' } };
}

function loginCookie(password) {
  const s = secret();
  if (!s || !safeEqual(password || '', s)) return null;
  const secure = process.env.VERCEL ? '; Secure' : '';
  return `tracket=${cookieValue()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`;
}

module.exports = { check, loginCookie };
