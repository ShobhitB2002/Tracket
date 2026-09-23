// Passwords (scrypt), signed session tokens (HMAC), and encryption at rest for
// members' Asana tokens (AES-256-GCM). Everything is keyed off SESSION_SECRET.
const crypto = require('crypto');

function secret() {
  const s = (process.env.SESSION_SECRET || '').trim();
  if (s.length >= 16) return s;
  if (process.env.VERCEL) { const e = new Error('Set SESSION_SECRET (32+ random characters) in Vercel, then redeploy.'); e.status = 500; throw e; }
  return 'local-dev-only-secret-change-me';
}
const subkey = (purpose) => crypto.createHash('sha256').update(`${secret()}:${purpose}`).digest();

const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
// Readable one-time passwords for members, e.g. "kite-4821-amber"
const WORDS = 'amber,atlas,birch,cedar,comet,coral,delta,ember,fable,fern,frost,harbor,indigo,iris,jade,juniper,kite,lotus,maple,meadow,nova,onyx,orbit,pine,quartz,raven,river,sage,slate,solar,spruce,tide,topaz,velvet,willow,zephyr'.split(',');
const pick = () => WORDS[crypto.randomInt(WORDS.length)];
const friendlyPassword = () => `${pick()}-${crypto.randomInt(1000, 10000)}-${pick()}`;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 32);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}
function verifyPassword(pw, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64url'), want.length);
  return crypto.timingSafeEqual(want, got);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// token = base64url(json).hmac
function sign(payload, ttlSec) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSec * 1000 })).toString('base64url');
  const mac = crypto.createHmac('sha256', subkey('session')).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verify(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', subkey('session')).update(body).digest('base64url');
  if (!safeEqual(mac, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', subkey('encrypt'), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}
function decrypt(blob) {
  const [v, iv, tag, enc] = String(blob || '').split('.');
  if (v !== 'v1') return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', subkey('encrypt'), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
  } catch { return null; }
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

module.exports = { randomToken, friendlyPassword, hashPassword, verifyPassword, safeEqual, sign, verify, encrypt, decrypt, sha };
