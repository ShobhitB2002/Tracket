// Every API route in one place, with who may call it:
//   public · member · admin
// Used by the Vercel function (api/router.js) and the local server.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const core = require('./core');
const users = require('./users');
const c = require('./crypto');
const { notifyRequest } = require('./notify');
const prefs = require('./prefs');
const push = require('./push');
const alerts = require('./alerts');
const report = require('./report');

const siteUrl = (req) => {
  const proto = String(req.headers['x-forwarded-proto'] || (process.env.VERCEL ? 'https' : 'http')).split(',')[0];
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
};

// The member's Asana token, decrypted just for this request.
async function memberCtx(who) {
  const pat = c.decrypt(await store.get(`u:${who.member.id}:pat`, { cache: 60000 }));
  if (!pat) throw users.bad(409, 'asana-not-connected');
  return { uid: who.member.id, pat };
}

const USERSCRIPT = path.join(__dirname, '..', 'tracket.user.js');
const MENUBAR = path.join(__dirname, '..', 'tracket.menubar.js');

// Reminders never break the request that triggered them.
const quietly = (p) => p.catch((e) => console.error('[alerts]', e.message));

// Every member with Asana connected, for /api/cron.
async function everyMember(fn) {
  const members = Object.values((await store.get('members')) || {}).filter((m) => m.status === 'active' && m.asana);
  const res = await Promise.allSettled(members.map(async (m) => {
    const pat = c.decrypt(await store.get(`u:${m.id}:pat`));
    if (pat) await fn({ uid: m.id, pat });
  }));
  return { members: members.length, failed: res.filter((r) => r.status === 'rejected').length };
}

// Work shift: { days: { <0=Sun..6=Sat>: { start: 'HH:MM', end: 'HH:MM' } } } in
// the member's local time. A day missing from `days` is a day off.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
function cleanShift(input) {
  const days = {};
  for (const [d, v] of Object.entries(input?.days || {})) {
    if (!/^[0-6]$/.test(d) || !v) continue;
    if (!HHMM.test(v.start || '') || !HHMM.test(v.end || '')) throw users.bad(400, 'Use HH:MM times');
    if (v.end <= v.start) throw users.bad(400, 'A shift has to end after it starts (overnight shifts aren’t supported yet)');
    days[d] = { start: v.start, end: v.end };
  }
  return { days };
}

const routes = {
  // ---------- public ----------
  // Which settings are present (never their values) — for setup troubleshooting.
  'GET /api/health': ['public', async () => {
    const has = (k) => !!(process.env[k] || '').trim();
    let db = false;
    try { await store.get('health'); db = true; } catch {}
    const storeInfo = db ? await store.info().catch(() => ({ backend: store.backend })) : { backend: store.backend };
    return {
      ok: has('ADMIN_PASSWORD') && has('SESSION_SECRET') && db,
      database_backend: storeInfo.backend,
      migrated_from_upstash: storeInfo.migrated || null,
      database_region: storeInfo.region || null,
      members: db ? Object.keys((await store.get('members').catch(() => null)) || {}).length : null,
      rows: db ? await store.count().catch(() => null) : null,
      function_region: process.env.VERCEL_REGION || null,
      admin_password: has('ADMIN_PASSWORD'),
      session_secret: has('SESSION_SECRET') && process.env.SESSION_SECRET.trim().length >= 16,
      database: db,
      email_pings: has('RESEND_API_KEY') && has('ADMIN_EMAIL'),
      email_via: require('./notify').emailVia(),
      env: process.env.VERCEL_ENV || 'local',
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
    };
  }],

  'GET /api/me': ['public', async ({ who }) => {
    if (who.role === 'member') {
      await users.touch(who.member.id);
      const shift = await store.get(`u:${who.member.id}:shift`);
      const p = await prefs.get(who.member.id);
      return { role: 'member', name: who.member.name, email: who.member.email, asana: !!who.member.asana, admin: who.admin, shift, prefs: p };
    }
    return { role: who.role, admin: who.admin };
  }],

  'POST /api/request': ['public', async ({ req, body }) => {
    await users.limit(req, 'request', 5, 3600);
    if (body.website) return { ok: true }; // honeypot: bots fill hidden fields
    const { request, duplicate } = await users.addRequest(body);
    if (!duplicate) await notifyRequest(request, siteUrl(req)).catch(() => false);
    return { ok: true, duplicate: !!duplicate };
  }],

  'POST /api/login': ['public', async ({ req, body }) => {
    await users.limit(req, 'login', 10, 900);
    const { cookie } = await users.login(body.email, body.password);
    return { body: { ok: true }, headers: { 'Set-Cookie': cookie } };
  }],

  // body.which: 'member' (dashboard), 'admin' (admin panel) or omitted for both
  'POST /api/logout': ['public', async ({ body }) => ({ body: { ok: true }, headers: { 'Set-Cookie': users.logoutCookies(body.which) } })],

  'POST /api/admin/login': ['public', async ({ req, body }) => {
    await users.limit(req, 'admin', 8, 900);
    return { body: { ok: true }, headers: { 'Set-Cookie': users.adminLogin(body.password) } };
  }],

  // ---------- member ----------
  'GET /api/today': ['member', async ({ who, query }) => core.today(await memberCtx(who), query)],
  'GET /api/live': ['member', async ({ who, query }) => {
    const ctx = await memberCtx(who);
    const { _state, _hb, ...out } = await core.live(ctx, query);
    // fallback trigger for reminders when no Asana tab reports (throttled to ~1/min)
    await quietly(alerts.evaluate(ctx, { tz: query.tz, state: _state, hb: _hb, source: 'live' }));
    return out;
  }],
  // Userscript reports. The answer carries any auto-mode action for the tab to show.
  'POST /api/event': ['member', async ({ who, body }) => {
    const ctx = await memberCtx(who);
    const pre = await store.mget([`u:${ctx.uid}:state`, `u:${ctx.uid}:autonow`]);
    let state = await core.onReport(ctx, body, { state: pre[`u:${ctx.uid}:state`] });
    if (state.suspect) { await core.settleSuspect(ctx); state = await core.getState(ctx); } // no dashboard needed
    let autonow = pre[`u:${ctx.uid}:autonow`];
    const offered = await alerts.autoStep(ctx, { tz: body.tz, state, autonow }).catch((e) => { console.error('[auto]', e.message); return null; });
    if (offered) autonow = offered;
    await quietly(alerts.evaluate(ctx, { tz: body.tz, state, source: 'event' }));
    return { ok: true, auto: await alerts.current(ctx.uid, autonow || null), now: Date.now() };
  }],
  'POST /api/auto': ['member', async ({ who, body }) => alerts.autoOp(await memberCtx(who), body)],

  'GET /api/prefs': ['member', async ({ who }) => prefs.get(who.member.id)],
  'POST /api/prefs': ['member', async ({ who, body, query }) => {
    const before = await prefs.get(who.member.id);
    const p = await prefs.update(who.member.id, { ...body, tz: body.tz || query.tz });
    if (JSON.stringify(before.lunch) !== JSON.stringify(p.lunch)) { // lunch minutes depend on it
      const tz = core.tzOf({ tz: p.tz });
      await store.del(`u:${who.member.id}:day:${core.ymdIn(Date.now(), tz)}`);
    }
    return p;
  }],
  'POST /api/lunch/fix': ['member', async ({ who, body, query }) => core.removeLunch(await memberCtx(who), String(body.entry || ''), { ...query, date: body.date })],

  // ---- notifications: Web Push devices + the alert feed ----
  'GET /api/push/key': ['member', async () => ({ key: (await push.vapid()).pub })],
  'GET /api/push': ['member', async ({ who }) => ({ devices: await push.devices(who.member.id) })],
  'POST /api/push': ['member', async ({ who, body }) => ({ ok: true, devices: await push.subscribe(who.member.id, body.sub, body.ua) })],
  'DELETE /api/push': ['member', async ({ who, body }) => { await push.unsubscribe(who.member.id, body.endpoint); return { ok: true }; }],
  'POST /api/push/test': ['member', async ({ who }) => push.sendTo(who.member.id, { title: 'Tracket test ✦', body: 'Notifications work on this device.', tag: 'test' })],
  'GET /api/alerts': ['member', async ({ who }) => { const f = await alerts.feed(who.member.id); return { items: f.items.slice(-30), seen: f.seen || 0 }; }],
  'POST /api/alerts/seen': ['member', async ({ who, body }) => ({ seen: await alerts.markSeen(who.member.id, body.upTo) })],

  // ---- daily email report ----
  'GET /api/report': ['member', async ({ who }) => ({ last: await store.get(`u:${who.member.id}:reportlast`) })],
  'POST /api/report/test': ['member', async ({ who, query, req }) => {
    await users.limit(req, 'report', 6, 3600);
    const ctx = await memberCtx(who);
    const tz = core.tzOf(query);
    return report.sendFor(ctx, core.ymdIn(Date.now(), tz), tz, { siteUrl: siteUrl(req) });
  }],
  'POST /api/email': ['member', async ({ who, body }) => ({ ok: true, email: await users.changeEmail(who.member.id, body.email, body.password) })],

  // ---- Mac menu bar (SwiftBar) ----
  'GET /api/bar': ['member', async ({ who, query, req }) => {
    const ctx = await memberCtx(who);
    const p = await prefs.get(ctx.uid);
    const u = (n) => `u:${ctx.uid}:${n}`;
    const tz0 = core.tzOf({ tz: query.tz || p.tz });
    const now = Date.now(), day = core.ymdIn(now, tz0);
    const g = await store.mget([u('hb'), u('state'), u(`day:${day}`), u('alerts')]);
    const hb = g[u('hb')], s = { running: null, suspect: null, ended: [], ...(g[u('state')] || {}) };
    const tz = tz0;
    let data = g[u(`day:${day}`)];
    if ((!data || now - data.fetchedAt > 90000) && (await store.lock(u('poll'), 8000))) data = await core.buildDay(ctx, day, tz, true).catch(() => data);
    await quietly(alerts.evaluate(ctx, { tz, state: s, hb, source: 'bar' }));
    const f = g[u('alerts')] || { items: [], seen: 0 };
    const run = s.running && core.ymdIn(s.running.startedAt, tz) === day ? s.running : null;
    return {
      site: siteUrl(req), serverNow: now, day,
      loggedMin: data?.totalMinutes || 0,
      running: run && { name: run.taskName, url: run.url, startedAt: run.startedAt },
      linked: !!hb && now - hb.at < core.FRESH_MS,
      tasks: (data?.tasks || []).slice(0, 12).map((t) => ({ name: t.name, url: t.url, min: t.minutes, warn: !!(t.check && !t.check.ok), noComment: t.comment === false, lunchMin: t.lunchMin || 0 })),
      unread: f.items.filter((a) => a.id > (f.seen || 0)).length,
      alerts: f.items.slice(-8).reverse().map((a) => ({ id: a.id, title: a.title, body: a.body, unread: a.id > (f.seen || 0) })),
    };
  }],
  // The SwiftBar plugin with this member's URL + key filled in.
  'GET /api/menubar': ['member', async ({ who, req }) => {
    const src = fs.readFileSync(MENUBAR, 'utf8')
      .replace(/^const TRACKET_URL = .*$/m, `const TRACKET_URL = ${JSON.stringify(siteUrl(req))};`)
      .replace(/^const TRACKET_KEY = .*$/m, `const TRACKET_KEY = ${JSON.stringify(users.apiKeyOf(who.member))};`);
    return { raw: src, type: 'text/javascript; charset=utf-8', filename: 'tracket.js' };
  }],
  'DELETE /api/running': ['member', async ({ who }) => { await core.clearRunning(await memberCtx(who)); return { ok: true }; }],

  'POST /api/asana': ['member', async ({ who, body }) => {
    const pat = String(body.pat || '').trim();
    if (pat.length < 20) throw users.bad(400, 'That doesn’t look like an Asana token');
    let asanaUser;
    try { asanaUser = await core.verifyPat(pat); } catch { throw users.bad(400, 'Asana rejected that token — check you copied all of it.'); }
    await store.set(`u:${who.member.id}:pat`, c.encrypt(pat));
    await store.del(`u:${who.member.id}:me`);
    await users.setAsanaConnected(who.member.id, true);
    return { ok: true, asanaName: asanaUser.name };
  }],

  'DELETE /api/asana': ['member', async ({ who }) => {
    for (const k of ['pat', 'me', 'state', 'hb', 'names', 'chk']) await store.del(`u:${who.member.id}:${k}`);
    await users.setAsanaConnected(who.member.id, false);
    return { ok: true };
  }],

  // A copy of the userscript with this member's URL + key already filled in.
  // Name and namespace are per member too: script managers identify a script by
  // them, so two members' copies in one browser never overwrite each other.
  'GET /api/userscript': ['member', async ({ who, req }) => {
    const m = who.member;
    const key = users.apiKeyOf(m);
    const label = String(m.name || m.email).replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 40) || 'member';
    const src = fs.readFileSync(USERSCRIPT, 'utf8')
      .replace(/^\/\/ @name .*$/m, `// @name         Tracket · ${label}`)
      .replace(/^\/\/ @namespace .*$/m, `// @namespace    tracket/${m.id}`)
      .replace(/^const TRACKET_URL = .*$/m, `const TRACKET_URL = ${JSON.stringify(siteUrl(req))};`)
      .replace(/^const TRACKET_KEY = .*$/m, `const TRACKET_KEY = ${JSON.stringify(key)};`);
    return { raw: src, type: 'text/javascript; charset=utf-8', filename: 'tracket.user.js' };
  }],

  // Same script at a *.user.js URL so Tampermonkey/Violentmonkey offer one-click install.
  'GET /api/tracket.user.js': ['member', async (ctx) => {
    const out = await routes['GET /api/userscript'][1](ctx);
    return { ...out, inline: true };
  }],

  'POST /api/shift': ['member', async ({ who, body }) => {
    const shift = cleanShift(body);
    await store.set(`u:${who.member.id}:shift`, shift);
    return { ok: true, shift };
  }],

  'POST /api/apikey': ['member', async ({ who }) => { await users.rotateApiKey(who.member.id); return { ok: true }; }],

  'POST /api/password': ['member', async ({ who, body }) => {
    const m = await users.changePassword(who.member.id, body.current, body.next);
    const { cookie } = await users.login(m.email, body.next); // refresh this session
    return { body: { ok: true }, headers: { 'Set-Cookie': cookie } };
  }],

  // ---------- scheduler ----------
  // Reminders and reports for members with no tab open. Point a scheduler
  // (Upstash QStash, cron-job.org…) at the URL from the admin panel, every 5 min.
  'GET /api/cron': ['public', async (ctx) => routes['POST /api/cron'][1](ctx)],
  'POST /api/cron': ['public', async ({ req, query }) => {
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const ok = c.safeEqual(String(query.key || ''), c.cronKey()) || (process.env.CRON_SECRET && c.safeEqual(bearer, process.env.CRON_SECRET));
    if (!ok) throw users.bad(401, 'bad cron key');
    const swept = await store.sweep().catch(() => 0); // drop expired rows
    return { ok: true, swept, ...(await everyMember((ctx) => alerts.evaluate(ctx, { source: 'cron' }))) };
  }],

  // ---------- admin (never sees members' Asana data) ----------
  'GET /api/admin/emailcheck': ['admin', async () => ({ ...(await require('./notify').checkEmail()), adminEmailSet: !!process.env.ADMIN_EMAIL })],
  'GET /api/admin/cron': ['admin', async ({ req }) => ({ url: `${siteUrl(req)}/api/cron?key=${c.cronKey()}` })],
  'GET /api/admin/overview': ['admin', async () => users.overview()],
  'POST /api/admin/approve': ['admin', async ({ body }) => users.decide(body.id, true)],
  'POST /api/admin/deny': ['admin', async ({ body }) => { await users.decide(body.id, false); return { ok: true }; }],
  'POST /api/admin/forget': ['admin', async ({ body }) => { await users.forgetRequest(body.id); return { ok: true }; }],
  'POST /api/admin/members': ['admin', async ({ body }) => users.createMember(body)],
  'POST /api/admin/reset': ['admin', async ({ body }) => users.resetPassword(body.id)],
  'POST /api/admin/status': ['admin', async ({ body }) => { await users.setStatus(body.id, body.status); return { ok: true }; }],
  'POST /api/admin/remove': ['admin', async ({ body }) => { await users.removeMember(body.id); return { ok: true }; }],
};

// Runs a route. Returns { status, headers, body | raw }.
async function dispatch({ method, pathname, query, body, req }) {
  const route = routes[`${method} ${pathname}`];
  if (!route) return { status: 404, body: { error: 'not found' } };
  const [access, fn] = route;
  try {
    const who = await users.resolve(req);
    if (access === 'member' && who.role !== 'member') return { status: 401, body: { error: who.badKey ? 'bad-key' : 'login-required' } };
    if (access === 'admin' && !who.admin) return { status: 401, body: { error: 'admin-required' } };
    const out = await fn({ who, query, body: body || {}, req });
    if (out && out.raw !== undefined) {
      const headers = { 'Content-Type': out.type };
      if (!out.inline) headers['Content-Disposition'] = `attachment; filename="${out.filename}"`;
      return { status: 200, raw: out.raw, headers };
    }
    if (out && out.body !== undefined && out.headers) return { status: 200, body: out.body, headers: out.headers };
    return { status: 200, body: out ?? { ok: true } };
  } catch (e) {
    // Asana's own errors (e.g. a revoked token) must not look like our auth errors
    const status = e.asana ? 502 : e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    return { status, body: { error: status === 500 && !e.status ? 'Something went wrong' : e.message } };
  }
}

module.exports = { dispatch };
