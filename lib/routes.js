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

const siteUrl = (req) => {
  const proto = String(req.headers['x-forwarded-proto'] || (process.env.VERCEL ? 'https' : 'http')).split(',')[0];
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
};

// The member's Asana token, decrypted just for this request.
async function memberCtx(who) {
  const pat = c.decrypt(await store.get(`u:${who.member.id}:pat`));
  if (!pat) throw users.bad(409, 'asana-not-connected');
  return { uid: who.member.id, pat };
}

const USERSCRIPT = path.join(__dirname, '..', 'tracket.user.js');

const routes = {
  // ---------- public ----------
  'GET /api/me': ['public', async ({ who }) => {
    if (who.role === 'member') {
      await users.touch(who.member.id);
      return { role: 'member', name: who.member.name, email: who.member.email, asana: !!who.member.asana };
    }
    return { role: who.role };
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

  'POST /api/logout': ['public', async () => ({ body: { ok: true }, headers: { 'Set-Cookie': users.logoutCookies() } })],

  'POST /api/admin/login': ['public', async ({ req, body }) => {
    await users.limit(req, 'admin', 8, 900);
    return { body: { ok: true }, headers: { 'Set-Cookie': users.adminLogin(body.password) } };
  }],

  // ---------- member ----------
  'GET /api/today': ['member', async ({ who, query }) => core.today(await memberCtx(who), query)],
  'GET /api/live': ['member', async ({ who, query }) => core.live(await memberCtx(who), query)],
  'POST /api/event': ['member', async ({ who, body }) => { await core.onReport(await memberCtx(who), body); return { ok: true }; }],
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
    for (const k of ['pat', 'me', 'state', 'hb', 'names']) await store.del(`u:${who.member.id}:${k}`);
    await users.setAsanaConnected(who.member.id, false);
    return { ok: true };
  }],

  // A copy of the userscript with this member's URL + key already filled in.
  'GET /api/userscript': ['member', async ({ who, req }) => {
    const key = users.apiKeyOf(who.member);
    const src = fs.readFileSync(USERSCRIPT, 'utf8')
      .replace(/^const TRACKET_URL = .*$/m, `const TRACKET_URL = ${JSON.stringify(siteUrl(req))};`)
      .replace(/^const TRACKET_KEY = .*$/m, `const TRACKET_KEY = ${JSON.stringify(key)};`);
    return { raw: src, type: 'text/javascript; charset=utf-8', filename: 'tracket.user.js' };
  }],

  'POST /api/apikey': ['member', async ({ who }) => { await users.rotateApiKey(who.member.id); return { ok: true }; }],

  'POST /api/password': ['member', async ({ who, body }) => {
    const m = await users.changePassword(who.member.id, body.current, body.next);
    const { cookie } = await users.login(m.email, body.next); // refresh this session
    return { body: { ok: true }, headers: { 'Set-Cookie': cookie } };
  }],

  // ---------- admin (never sees members' Asana data) ----------
  'GET /api/admin/overview': ['admin', async () => users.overview()],
  'POST /api/admin/approve': ['admin', async ({ body }) => users.decide(body.id, true)],
  'POST /api/admin/deny': ['admin', async ({ body }) => { await users.decide(body.id, false); return { ok: true }; }],
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
    if (access === 'admin' && who.role !== 'admin') return { status: 401, body: { error: 'admin-required' } };
    const out = await fn({ who, query, body: body || {}, req });
    if (out && out.raw !== undefined) {
      return { status: 200, raw: out.raw, headers: { 'Content-Type': out.type, 'Content-Disposition': `attachment; filename="${out.filename}"` } };
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
