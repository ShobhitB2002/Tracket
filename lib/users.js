// Members, access requests, sessions and API keys.
//
// Who can do what:
//   guest  → sees the landing page + demo, can request access
//   member → their own dashboard; their Asana token is encrypted at rest
//   admin  → approves requests and manages members (never sees members' Asana data)
const store = require('./store');
const c = require('./crypto');

const now = () => Date.now();
const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;
const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const bad = (status, error) => { const e = new Error(error); e.status = status; return e; };

const getMembers = async () => (await store.get('members')) || {};
const putMembers = (m) => store.set('members', m);
const getRequests = async () => (await store.get('requests')) || {};
const putRequests = (r) => store.set('requests', r);
const getKeys = async () => (await store.get('apikeys')) || {};
const putKeys = (k) => store.set('apikeys', k);

// What the admin panel may see about a member — no secrets, no Asana data.
function publicMember(m, seen) {
  return { id: m.id, name: m.name, email: m.email, status: m.status, createdAt: m.createdAt, asana: !!m.asana, lastActive: seen || null };
}

// ---------- sessions ----------
const MEMBER_COOKIE = 'tk_s';
const ADMIN_COOKIE = 'tk_a';
const cookie = (name, value, maxAge) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.VERCEL ? '; Secure' : ''}`;
const readCookie = (req, name) => {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
};
const adminStamp = () => c.sha('admin:' + (process.env.ADMIN_PASSWORD || '')).slice(0, 12);

// Resolves the caller. `role` is 'member' or 'guest'; `admin` is separate, so
// you can be logged in as a member (your dashboard) and as admin at once.
async function resolve(req) {
  const a = c.verify(readCookie(req, ADMIN_COOKIE));
  const admin = !!(a?.admin && a.stamp === adminStamp() && process.env.ADMIN_PASSWORD);
  const key = req.headers['x-tracket-key'];
  if (key) {
    const id = (await getKeys())[c.sha(key)];
    const m = id && (await getMembers())[id];
    if (m && m.status === 'active') return { role: 'member', member: m, via: 'key', admin: false };
    return { role: 'guest', badKey: true, admin: false };
  }
  const s = c.verify(readCookie(req, MEMBER_COOKIE));
  if (s?.uid) {
    const m = (await getMembers())[s.uid];
    if (m && m.status === 'active' && m.sv === s.sv) return { role: 'member', member: m, via: 'cookie', admin };
  }
  return { role: 'guest', admin };
}

async function touch(id) {
  const k = `u:${id}:seen`;
  const last = await store.get(k);
  if (!last || now() - last > 5 * 60000) await store.set(k, now());
}

// ---------- rate limiting ----------
async function limit(req, bucket, max, windowSec) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].trim();
  const n = await store.incr(`rl:${bucket}:${c.sha(ip).slice(0, 16)}`, windowSec);
  if (n > max) throw bad(429, 'Too many attempts — try again in a bit.');
}

// ---------- members ----------
async function createMember({ name, email }) {
  email = normEmail(email);
  name = clean(name, 80) || email.split('@')[0];
  if (!validEmail(email)) throw bad(400, 'Enter a valid email');
  const members = await getMembers();
  if (Object.values(members).some((m) => m.email === email)) throw bad(409, 'A member with that email already exists');
  const password = c.friendlyPassword();
  const apiKey = 'tk_' + c.randomToken(24);
  const id = c.randomToken(9);
  members[id] = {
    id, name, email, status: 'active', createdAt: now(), asana: false,
    pw: c.hashPassword(password), sv: 1, apiKeyEnc: c.encrypt(apiKey),
  };
  await putMembers(members);
  const keys = await getKeys(); keys[c.sha(apiKey)] = id; await putKeys(keys);
  return { member: publicMember(members[id]), password };
}

async function resetPassword(id) {
  const members = await getMembers();
  const m = members[id]; if (!m) throw bad(404, 'No such member');
  const password = c.friendlyPassword();
  m.pw = c.hashPassword(password); m.sv = (m.sv || 1) + 1; // logs out other sessions
  await putMembers(members);
  return { password };
}

async function changePassword(id, current, next) {
  if (String(next || '').length < 8) throw bad(400, 'New password must be at least 8 characters');
  const members = await getMembers();
  const m = members[id];
  if (!m || !c.verifyPassword(current, m.pw)) throw bad(401, 'Current password is wrong');
  m.pw = c.hashPassword(next); m.sv = (m.sv || 1) + 1;
  await putMembers(members);
  return m;
}

async function setStatus(id, status) {
  if (!['active', 'disabled'].includes(status)) throw bad(400, 'Bad status');
  const members = await getMembers();
  if (!members[id]) throw bad(404, 'No such member');
  members[id].status = status;
  if (status === 'disabled') members[id].sv = (members[id].sv || 1) + 1;
  await putMembers(members);
}

async function removeMember(id) {
  const members = await getMembers();
  const m = members[id]; if (!m) throw bad(404, 'No such member');
  const apiKey = c.decrypt(m.apiKeyEnc);
  delete members[id];
  await putMembers(members);
  if (apiKey) { const keys = await getKeys(); delete keys[c.sha(apiKey)]; await putKeys(keys); }
  for (const k of ['pat', 'state', 'hb', 'me', 'names', 'seen', 'shift', 'chk']) await store.del(`u:${id}:${k}`);
}

async function rotateApiKey(id) {
  const members = await getMembers();
  const m = members[id]; if (!m) throw bad(404, 'No such member');
  const keys = await getKeys();
  const old = c.decrypt(m.apiKeyEnc);
  if (old) delete keys[c.sha(old)];
  const apiKey = 'tk_' + c.randomToken(24);
  keys[c.sha(apiKey)] = id;
  m.apiKeyEnc = c.encrypt(apiKey);
  await putKeys(keys);
  await putMembers(members);
  return apiKey;
}

const apiKeyOf = (m) => c.decrypt(m.apiKeyEnc);

async function login(email, password) {
  email = normEmail(email);
  const m = Object.values(await getMembers()).find((x) => x.email === email);
  // same work either way, so timing doesn't reveal which emails exist
  const ok = c.verifyPassword(password, m ? m.pw : 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  if (!m || !ok) throw bad(401, 'Wrong email or password');
  if (m.status !== 'active') throw bad(403, 'Your access has been paused. Contact the admin.');
  return { member: m, cookie: cookie(MEMBER_COOKIE, c.sign({ uid: m.id, sv: m.sv }, 30 * 24 * 3600), 30 * 24 * 3600) };
}

function adminLogin(password) {
  const want = process.env.ADMIN_PASSWORD || '';
  if (!want) throw bad(500, 'Set ADMIN_PASSWORD in your environment variables to use the admin panel.');
  if (!c.safeEqual(password || '', want)) throw bad(401, 'Wrong admin password');
  return cookie(ADMIN_COOKIE, c.sign({ admin: true, stamp: adminStamp() }, 7 * 24 * 3600), 7 * 24 * 3600);
}

const logoutCookies = (which = 'all') => [
  ...(which !== 'admin' ? [cookie(MEMBER_COOKIE, '', 0)] : []),
  ...(which !== 'member' ? [cookie(ADMIN_COOKIE, '', 0)] : []),
];

// ---------- access requests ----------
async function addRequest({ name, email, note }) {
  email = normEmail(email);
  name = clean(name, 80);
  note = clean(note, 500);
  if (!name) throw bad(400, 'Tell us your name');
  if (!validEmail(email)) throw bad(400, 'Enter a valid email');
  if (Object.values(await getMembers()).some((m) => m.email === email)) throw bad(409, 'That email already has access — log in instead.');
  const reqs = await getRequests();
  const dupe = Object.values(reqs).find((r) => r.email === email && r.status === 'pending');
  if (dupe) return { request: dupe, duplicate: true };
  const id = c.randomToken(9);
  reqs[id] = { id, name, email, note, at: now(), status: 'pending' };
  await putRequests(reqs);
  return { request: reqs[id] };
}

async function decide(id, approve) {
  const reqs = await getRequests();
  const r = reqs[id]; if (!r) throw bad(404, 'No such request');
  // A denial can be reversed; an approval can't (pause or remove the member instead).
  if (r.status === 'approved') throw bad(409, 'Already approved — manage them under Members');
  if (r.status === 'denied' && !approve) return null;
  let created = null;
  if (approve) created = await createMember({ name: r.name, email: r.email });
  r.status = approve ? 'approved' : 'denied';
  r.decidedAt = now();
  await putRequests(reqs);
  return created;
}

async function forgetRequest(id) {
  const reqs = await getRequests();
  if (!reqs[id]) throw bad(404, 'No such request');
  delete reqs[id];
  await putRequests(reqs);
}

async function overview() {
  const members = await getMembers();
  const list = [];
  for (const m of Object.values(members)) list.push(publicMember(m, await store.get(`u:${m.id}:seen`)));
  list.sort((a, b) => b.createdAt - a.createdAt);
  const requests = Object.values(await getRequests()).sort((a, b) => b.at - a.at).slice(0, 200);
  return { members: list, requests };
}

async function setAsanaConnected(id, connected) {
  const members = await getMembers();
  if (!members[id]) return;
  members[id].asana = connected;
  await putMembers(members);
}

module.exports = {
  resolve, touch, limit, login, adminLogin, logoutCookies,
  createMember, resetPassword, changePassword, setStatus, removeMember, rotateApiKey, apiKeyOf,
  addRequest, decide, forgetRequest, overview, setAsanaConnected, bad,
};
