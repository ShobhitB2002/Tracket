// Tiny key-value store with three backends, picked by env:
//   Turso (libSQL over HTTP)  TURSO_DATABASE_URL + TURSO_AUTH_TOKEN — preferred:
//                             the free plan has 500M row reads / 10M writes a month
//   Upstash Redis (REST)      KV_REST_API_URL + KV_REST_API_TOKEN — free plan is
//                             500K commands a month, which one busy member can use up
//   JSON file in ./data       local development
// When Turso is on and Upstash is still configured, the first request copies
// everything from Upstash into Turso once (see migrate()).
const fs = require('fs');
const path = require('path');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TURSO_URL = (process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || '').trim().replace(/^(libsql|turso|wss?):\/\//, 'https://').replace(/\/+$/, '');
const TURSO_TOKEN = (process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || '').trim();
const PREFIX = 'tracket:';

const hasRedis = !!(REDIS_URL && REDIS_TOKEN);
const backend = TURSO_URL && TURSO_TOKEN ? 'turso' : hasRedis ? 'redis' : 'file';
const hosted = backend !== 'file';

function assertConfigured() {
  if (!hosted && process.env.VERCEL) {
    const e = new Error('No database connected. In Vercel: Storage → Create → Turso (or Upstash for Redis) → connect to this project, then redeploy.');
    e.status = 500;
    throw e;
  }
}

// ---------- Upstash Redis ----------
async function redis(cmd) {
  const res = await fetch(REDIS_URL, { method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`Redis: ${body.error || res.status}`);
  return body.result;
}
async function redisPipeline(cmds) {
  const res = await fetch(REDIS_URL.replace(/\/+$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body)) throw new Error(`Redis pipeline: ${res.status}`);
  return body.map((x) => x.result);
}

// ---------- Turso (libSQL HTTP) ----------
const arg = (v) => (v == null ? { type: 'null' } : typeof v === 'number' ? { type: 'integer', value: String(Math.round(v)) } : { type: 'text', value: String(v) });
const cell = (c) => (c == null || c.type === 'null' ? null : c.type === 'integer' ? Number(c.value) : c.value);

// Runs statements in one HTTP request; returns [{ rows, affected }] per statement.
async function sql(stmts) {
  const res = await fetch(TURSO_URL + '/v2/pipeline', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TURSO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [...stmts.map((s) => ({ type: 'execute', stmt: { sql: s.sql, args: (s.args || []).map(arg) } })), { type: 'close' }] }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Turso: ${body.message || body.error || res.status}`);
  return body.results.slice(0, stmts.length).map((r) => {
    if (r.type !== 'ok') throw new Error(`Turso: ${r.error?.message || 'error'}`);
    const x = r.response.result;
    return { rows: x.rows.map((row) => row.map(cell)), affected: x.affected_row_count };
  });
}

const SCHEMA = 'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER)';
let readyP = null;
function ready() {
  if (backend !== 'turso') return Promise.resolve();
  if (!readyP) readyP = (async () => {
    await sql([{ sql: SCHEMA }]);
    // a failed copy must never take the site down (e.g. Upstash already deleted)
    if (hasRedis) await migrate().catch((e) => console.error('[store] Upstash copy skipped:', e.message));
  })().catch((e) => { readyP = null; throw e; });
  return readyP;
}
async function t(stmts) { await ready(); return sql(stmts); }
const live = (exp, now) => exp == null || exp > now;

// One-time copy Upstash → Turso (all tracket:* keys with their TTLs). Runs under
// a lock; other instances wait for it. Upstash is left untouched.
let migrated = null;
async function migrate() {
  const done = await sql([{ sql: "SELECT k, v FROM kv WHERE k IN ('__migrated', 'members')" }]);
  const row = (k) => done[0].rows.find((r) => r[0] === k);
  if (row('__migrated')) { migrated = JSON.parse(row('__migrated')[1]); return; }
  // Turso already has members → it's the live copy; never overwrite it with Upstash
  if (row('members')) {
    migrated = { at: Date.now(), copied: 0, note: 'Turso already had data' };
    await sql([{ sql: "INSERT INTO kv (k, v, exp) VALUES ('__migrated', ?, NULL) ON CONFLICT(k) DO NOTHING", args: [JSON.stringify(migrated)] }]);
    return;
  }
  const now = Date.now();
  const got = await sql([{ sql: "INSERT INTO kv (k, v, exp) VALUES ('lock:__migrate', '1', ?) ON CONFLICT(k) DO UPDATE SET v = '1', exp = excluded.exp WHERE kv.exp IS NOT NULL AND kv.exp <= ? RETURNING k", args: [now + 120000, now] }]);
  if (!got[0].rows.length) {
    for (let i = 0; i < 40; i++) { // someone else is copying: wait for it
      await new Promise((r) => setTimeout(r, 500));
      const d = await sql([{ sql: "SELECT v FROM kv WHERE k = '__migrated'" }]);
      if (d[0].rows.length) { migrated = JSON.parse(d[0].rows[0][0]); return; }
    }
    throw new Error('Database is being moved — try again in a moment');
  }
  let cursor = '0', copied = 0;
  do {
    const [next, keys] = await redis(['SCAN', cursor, 'MATCH', PREFIX + '*', 'COUNT', 500]);
    cursor = String(next);
    const wanted = keys.filter((k) => !k.startsWith(PREFIX + 'lock:') && !k.startsWith(PREFIX + 'rl:'));
    if (!wanted.length) continue;
    const vals = await redisPipeline(wanted.flatMap((k) => [['GET', k], ['PTTL', k]]));
    const stmts = [];
    wanted.forEach((k, i) => {
      const v = vals[i * 2], ttl = Number(vals[i * 2 + 1]);
      if (v == null || ttl === -2) return;
      stmts.push({ sql: 'INSERT INTO kv (k, v, exp) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp', args: [k.slice(PREFIX.length), v, ttl > 0 ? Date.now() + ttl : null] });
    });
    for (let i = 0; i < stmts.length; i += 100) await sql(stmts.slice(i, i + 100));
    copied += stmts.length;
  } while (cursor !== '0');
  const mark = { at: Date.now(), copied };
  await sql([{ sql: "INSERT INTO kv (k, v, exp) VALUES ('__migrated', ?, NULL) ON CONFLICT(k) DO UPDATE SET v = excluded.v", args: [JSON.stringify(mark)] }]);
  migrated = mark; // only after the marker is really saved
}

// ---------- local file ----------
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

// ---------- in-instance cache ----------
// Warm serverless instances serve many requests; values that rarely change
// (members, API keys, tokens, prefs) are kept for a few seconds to save reads.
// Another instance's write can take up to `cache` ms to be seen here.
const memo = new Map();
const remember = (key, value) => { if (memo.has(key)) memo.set(key, { v: value, at: Date.now() }); };

// ---------- API ----------
async function get(key, { cache = 0 } = {}) {
  assertConfigured();
  if (cache) { const m = memo.get(key); if (m && Date.now() - m.at < cache) return m.v; }
  let v;
  if (backend === 'turso') {
    const [r] = await t([{ sql: 'SELECT v, exp FROM kv WHERE k = ?', args: [key] }]);
    const row = r.rows[0];
    v = row && live(row[1], Date.now()) ? JSON.parse(row[0]) : null;
  } else if (backend === 'redis') { const x = await redis(['GET', PREFIX + key]); v = x == null ? null : JSON.parse(x); }
  else v = load()[key]?.v ?? null;
  if (cache) memo.set(key, { v, at: Date.now() });
  return v;
}

// Several keys in one command / one query → { key: value | null }
async function mget(keys) {
  assertConfigured();
  keys = [...new Set(keys)];
  const out = Object.fromEntries(keys.map((k) => [k, null]));
  if (!keys.length) return out;
  if (backend === 'turso') {
    const [r] = await t([{ sql: `SELECT k, v, exp FROM kv WHERE k IN (${keys.map(() => '?').join(',')})`, args: keys }]);
    const now = Date.now();
    for (const [k, v, exp] of r.rows) if (live(exp, now)) out[k] = JSON.parse(v);
  } else if (backend === 'redis') {
    const vals = await redis(['MGET', ...keys.map((k) => PREFIX + k)]);
    keys.forEach((k, i) => { out[k] = vals[i] == null ? null : JSON.parse(vals[i]); });
  } else { const m = load(); for (const k of keys) out[k] = m[k]?.v ?? null; }
  return out;
}

async function set(key, value, ttlSec) {
  assertConfigured();
  remember(key, value);
  if (backend === 'turso') {
    await t([{ sql: 'INSERT INTO kv (k, v, exp) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp', args: [key, JSON.stringify(value), ttlSec ? Date.now() + ttlSec * 1000 : null] }]);
    return;
  }
  if (backend === 'redis') return redis(ttlSec ? ['SET', PREFIX + key, JSON.stringify(value), 'EX', ttlSec] : ['SET', PREFIX + key, JSON.stringify(value)]);
  load()[key] = { v: value, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 };
  persist();
}

async function del(key) {
  assertConfigured();
  remember(key, null);
  if (backend === 'turso') { await t([{ sql: 'DELETE FROM kv WHERE k = ?', args: [key] }]); return; }
  if (backend === 'redis') return redis(['DEL', PREFIX + key]);
  delete load()[key];
  persist();
}

// Counter with an expiry window (rate limiting).
async function incr(key, windowSec) {
  assertConfigured();
  const now = Date.now();
  if (backend === 'turso') {
    const [r] = await t([{ sql: `INSERT INTO kv (k, v, exp) VALUES (?, '1', ?) ON CONFLICT(k) DO UPDATE SET
      v = CASE WHEN kv.exp IS NOT NULL AND kv.exp <= ? THEN '1' ELSE CAST(CAST(kv.v AS INTEGER) + 1 AS TEXT) END,
      exp = CASE WHEN kv.exp IS NOT NULL AND kv.exp <= ? THEN excluded.exp ELSE kv.exp END RETURNING v`, args: [key, now + windowSec * 1000, now, now] }]);
    return Number(r.rows[0][0]);
  }
  if (backend === 'redis') {
    const n = await redis(['INCR', PREFIX + key]);
    if (n === 1) await redis(['EXPIRE', PREFIX + key, windowSec]);
    return n;
  }
  const m = load();
  const cur = m[key] || { v: 0, exp: now + windowSec * 1000 };
  cur.v += 1;
  m[key] = cur;
  persist();
  return cur.v;
}

// Returns true if we got the lock (used so only one request polls Asana at a time).
async function lock(key, ms) {
  assertConfigured();
  const now = Date.now();
  if (backend === 'turso') {
    const [r] = await t([{ sql: "INSERT INTO kv (k, v, exp) VALUES (?, '1', ?) ON CONFLICT(k) DO UPDATE SET v = '1', exp = excluded.exp WHERE kv.exp IS NOT NULL AND kv.exp <= ? RETURNING k", args: ['lock:' + key, now + ms, now] }]);
    return r.rows.length > 0;
  }
  if (backend === 'redis') return (await redis(['SET', PREFIX + 'lock:' + key, '1', 'NX', 'PX', ms])) === 'OK';
  const m = load();
  if (m['lock:' + key]) return false;
  m['lock:' + key] = { v: 1, exp: now + ms };
  return true;
}

// Cheaper than a lock when a little slack is fine: at most once per `ms` per
// warm instance (no database call at all when it says no).
const last = new Map();
function throttle(key, ms) {
  const now = Date.now();
  if (now - (last.get(key) || 0) < ms) return false;
  last.set(key, now);
  return true;
}

// Deletes expired rows (Turso keeps them until then). Called from /api/cron.
async function sweep() {
  if (backend !== 'turso') return 0;
  const [r] = await t([{ sql: 'DELETE FROM kv WHERE exp IS NOT NULL AND exp <= ?', args: [Date.now()] }]);
  return r.affected;
}

const info = async () => { if (backend === 'turso') await ready(); return { backend, migrated, region: backend === 'turso' ? (TURSO_URL.match(/\.(aws-[a-z0-9-]+|[a-z]{3})\.turso\.io/) || [])[1] || null : null }; };

module.exports = { get, mget, set, del, incr, lock, throttle, sweep, info, hosted, backend };
