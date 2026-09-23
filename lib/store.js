// Tiny key-value store. Hosted: Upstash Redis over REST (Vercel's Redis
// integration sets these env vars). Local: a JSON file in ./data.
const fs = require('fs');
const path = require('path');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const PREFIX = 'tracket:';

async function redis(cmd) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`Redis: ${body.error || res.status}`);
  return body.result;
}

// ---- local file store ----
const FILE = path.join(__dirname, '..', 'data', 'store.json');
let mem = null;
function load() {
  if (!mem) { try { mem = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { mem = {}; } }
  const now = Date.now();
  for (const [k, v] of Object.entries(mem)) if (v.exp && v.exp < now) delete mem[k];
  return mem;
}
function persist() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(mem));
}

const hosted = !!(REDIS_URL && REDIS_TOKEN);

function assertConfigured() {
  if (!hosted && process.env.VERCEL) {
    const e = new Error('No database connected. In Vercel: Storage → Create → Upstash for Redis → connect to this project, then redeploy.');
    e.status = 500;
    throw e;
  }
}

async function get(key) {
  assertConfigured();
  if (hosted) { const v = await redis(['GET', PREFIX + key]); return v == null ? null : JSON.parse(v); }
  return load()[key]?.v ?? null;
}

async function set(key, value, ttlSec) {
  assertConfigured();
  if (hosted) return redis(ttlSec ? ['SET', PREFIX + key, JSON.stringify(value), 'EX', ttlSec] : ['SET', PREFIX + key, JSON.stringify(value)]);
  load()[key] = { v: value, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 };
  persist();
}

async function del(key) {
  assertConfigured();
  if (hosted) return redis(['DEL', PREFIX + key]);
  delete load()[key];
  persist();
}

// Counter with an expiry window (rate limiting).
async function incr(key, windowSec) {
  assertConfigured();
  if (hosted) {
    const n = await redis(['INCR', PREFIX + key]);
    if (n === 1) await redis(['EXPIRE', PREFIX + key, windowSec]);
    return n;
  }
  const m = load();
  const cur = m[key] || { v: 0, exp: Date.now() + windowSec * 1000 };
  cur.v += 1;
  m[key] = cur;
  persist();
  return cur.v;
}

// Returns true if we got the lock (used so only one request polls Asana at a time).
async function lock(key, ms) {
  assertConfigured();
  if (hosted) return (await redis(['SET', PREFIX + 'lock:' + key, '1', 'NX', 'PX', ms])) === 'OK';
  const m = load();
  if (m['lock:' + key]) return false;
  m['lock:' + key] = { v: 1, exp: Date.now() + ms };
  return true;
}

module.exports = { get, set, del, incr, lock, hosted };
