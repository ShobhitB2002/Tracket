// Slack status while a timer runs: "🟢 On: <ticket>", cleared when it stops.
// Each member connects their own Slack user token (a small Slack app with the
// users.profile:write scope, see Settings → Slack status). Stored encrypted,
// like the Asana token. Only a status Tracket set is ever cleared.
const store = require('./store');
const c = require('./crypto');

const K = (uid, n) => `u:${uid}:${n}`;
const API = 'https://slack.com/api/';

async function call(token, method, body) {
  require('./usage').add('slack');
  const res = await fetch(API + method, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body || {}) });
  const out = await res.json().catch(() => ({}));
  if (!out.ok) { const e = new Error(`Slack: ${out.error || res.status}`); e.status = 400; throw e; }
  return out;
}
const tokenOf = async (uid) => c.decrypt(await store.get(K(uid, 'slack'), { cache: 60000 }));

async function connect(uid, token) {
  token = String(token || '').trim();
  if (!/^xoxp-/.test(token)) { const e = new Error('Paste the “User OAuth Token” — it starts with xoxp-'); e.status = 400; throw e; }
  const who = await call(token, 'auth.test');
  await store.set(K(uid, 'slack'), c.encrypt(token));
  await store.set(K(uid, 'slackinfo'), { team: who.team, user: who.user, at: Date.now() });
  return { ok: true, team: who.team, user: who.user };
}
async function disconnect(uid) {
  const token = await tokenOf(uid);
  const st = await store.get(K(uid, 'slackst'));
  if (token && st?.set) await call(token, 'users.profile.set', { profile: { status_text: '', status_emoji: '', status_expiration: 0 } }).catch(() => {});
  await store.del(K(uid, 'slack')); await store.del(K(uid, 'slackinfo')); await store.del(K(uid, 'slackst'));
  return { ok: true };
}
const info = (uid) => store.get(K(uid, 'slackinfo'));

// Makes Slack match the running timer. Cheap when nothing changed (one read).
async function sync(ctx, running, { force } = {}) {
  const uid = ctx.uid;
  const want = running ? `r:${running.startedAt}` : 'none';
  const st = (await store.get(K(uid, 'slackst'))) || {};
  if (!force && st.want === want) return;
  const token = await tokenOf(uid);
  const p = await require('./prefs').get(uid);
  if (!token || !p.slack.on) { if (st.want !== want) await store.set(K(uid, 'slackst'), { ...st, want }, 7 * 24 * 3600); return; }
  if (running) {
    const text = `On: ${running.taskName || 'a ticket'}`.slice(0, 100);
    await call(token, 'users.profile.set', { profile: { status_text: text, status_emoji: p.slack.emoji || ':large_green_circle:', status_expiration: Math.round(Date.now() / 1000) + 12 * 3600 } });
    await store.set(K(uid, 'slackst'), { want, set: true, at: Date.now() }, 7 * 24 * 3600);
  } else {
    if (st.set) await call(token, 'users.profile.set', { profile: { status_text: '', status_emoji: '', status_expiration: 0 } });
    await store.set(K(uid, 'slackst'), { want, set: false, at: Date.now() }, 7 * 24 * 3600);
  }
}

async function test(uid) {
  const token = await tokenOf(uid);
  if (!token) { const e = new Error('Connect Slack first'); e.status = 400; throw e; }
  await call(token, 'users.profile.set', { profile: { status_text: 'Testing Tracket ✦', status_emoji: ':large_green_circle:', status_expiration: Math.round(Date.now() / 1000) + 120 } });
  await store.set(K(uid, 'slackst'), { want: 'test', set: true, at: Date.now() }, 7 * 24 * 3600);
  return { ok: true };
}

module.exports = { connect, disconnect, info, sync, test };
