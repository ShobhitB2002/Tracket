// Approximate usage, for the admin's "Hosting usage" page: API requests (Vercel
// function calls), database reads/writes (Turso rows), Asana calls, emails and
// pushes. Counted in memory per instance and added to one row per UTC day
// (`use:<YYYY-MM-DD>`) at most once a minute — so it costs ~1 write a minute,
// and a few counts can be lost when an instance is recycled.
const store = require('./store');

const counts = {};
let lastFlush = Date.now();
const add = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };

async function flush(force) {
  if (!force && Date.now() - lastFlush < 60000) return;
  lastFlush = Date.now();
  const snap = { ...counts, reads: store.ops.reads, writes: store.ops.writes };
  for (const k of Object.keys(counts)) delete counts[k];
  store.ops.reads = 0; store.ops.writes = 0;
  if (!Object.values(snap).some(Boolean)) return;
  const key = `use:${new Date().toISOString().slice(0, 10)}`;
  try {
    const cur = (await store.get(key)) || {};
    for (const [k, v] of Object.entries(snap)) if (v) cur[k] = (cur[k] || 0) + v;
    await store.set(key, cur, 45 * 24 * 3600);
  } catch { /* never break a request over usage */ }
}

// Free-tier limits (monthly unless noted) — see PROGRESS.md "Free-tier budget".
const LIMITS = { requests: 1000000, reads: 500000000, writes: 10000000, emailsPerDay: 500 };

async function report() {
  await flush(true);
  const now = new Date();
  const days = [...Array(31)].map((_, i) => new Date(now.getTime() - (30 - i) * 864e5).toISOString().slice(0, 10));
  const got = await store.mget(days.map((d) => `use:${d}`));
  const rows = days.map((d) => ({ day: d, ...(got[`use:${d}`] || {}) }));
  const month = now.toISOString().slice(0, 7);
  const mtd = rows.filter((r) => r.day.startsWith(month));
  const sum = (k, list = mtd) => list.reduce((a, r) => a + (r[k] || 0), 0);
  const dim = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getDate();
  const elapsed = now.getUTCDate() - 1 + (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440 || 1;
  const project = (k) => Math.round(sum(k) / elapsed * dim);
  const metric = (k, limit, label) => ({ key: k, label, month: sum(k), projected: project(k), limit, pct: limit ? Math.round(project(k) / limit * 100) : null });
  return {
    month, since: mtd[0]?.day || null,
    metrics: [metric('requests', LIMITS.requests, 'API requests (Vercel function calls)'), metric('reads', LIMITS.reads, 'Database row reads (Turso)'),
      metric('writes', LIMITS.writes, 'Database row writes (Turso)'), metric('asana', null, 'Asana API calls'), metric('push', null, 'Push notifications')],
    emailsToday: rows[rows.length - 1].email || 0, emailLimitPerDay: LIMITS.emailsPerDay,
    days: rows.map((r) => ({ day: r.day, requests: r.requests || 0, reads: r.reads || 0, writes: r.writes || 0, asana: r.asana || 0, email: r.email || 0 })),
  };
}

module.exports = { add, flush, report, LIMITS };
