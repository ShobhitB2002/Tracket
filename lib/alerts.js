// Server-side reminders and auto mode. Runs without any browser open, so
// alerts reach phones (Web Push), the menu bar and the daily email.
//
// Triggers (serverless has no timers): every userscript heartbeat (/api/event),
// every dashboard poll (/api/live), and /api/cron (an external scheduler).
//   evaluate() — reminders + daily report; at most every ~12s per member
//   autoStep() — auto mode; on userscript heartbeats only, since only an open
//                Asana tab can press Asana's timer buttons
//
// Keys (per member): alerts (feed), rt:<day> (what was sent today),
// auto:<day> (auto actions issued), autost:<id> (their status), autonow (the
// action in progress, for fast reads), lock:autoclaim:<id> (who decided it).
const store = require('./store');
const core = require('./core');
const prefs = require('./prefs');
const push = require('./push');

const K = (uid, n) => `u:${uid}:${n}`;
const H = 3600e3, MIN = 60e3;
const MIN_SEC = 7 * 3600, GOAL_SEC = 8 * 3600;
const COUNTDOWN = 25000;

// The owner's wording — keep it.
const LINES = {
  ok: 'Hey man, you logged the bare minimum. You can tap out now if you want.',
  over: 'You sure you know what you’re doing? That’s enough work for today!',
  low: 'Oh no! Are you sure you wanna log out now? You want to receive that mail?',
  comment: 'Dude u forgot to mention what u did in this ticket, all good?',
  lunch: 'Today u ran timer during lunch, wanna edit that?',
};

const pad = (n) => String(n).padStart(2, '0');
const hm = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h ? `${h}h ${pad(m)}m` : `${m}m`; };

// ---------- feed: u:<id>:alerts = { items: [{ id, day, kind, title, body }], seen } ----------
async function feed(uid) { return (await store.get(K(uid, 'alerts'))) || { items: [], seen: 0 }; }

async function addAlert(uid, a, pushExtra = {}) {
  const f = await feed(uid);
  const item = { id: Math.max(Date.now(), (f.items[f.items.length - 1]?.id || 0) + 1), day: a.day, kind: a.kind, title: a.title, body: a.body || '' };
  f.items = [...f.items, item].slice(-60);
  await store.set(K(uid, 'alerts'), f, 8 * 24 * 3600);
  await push.sendTo(uid, { title: item.title, body: item.body, tag: a.tag || `${item.kind}-${item.id}`, ...pushExtra }).catch(() => {});
  return item;
}

async function markSeen(uid, upTo) {
  const f = await feed(uid);
  const to = Math.min(Number(upTo) || 0, f.items[f.items.length - 1]?.id || 0);
  if (to > (f.seen || 0)) { f.seen = to; await store.set(K(uid, 'alerts'), f, 8 * 24 * 3600); }
  return f.seen || 0;
}

// ---------- shift, in the member's zone ----------
function shiftFor(shift, day, tz) {
  const v = shift?.days?.[new Date(`${day}T12:00:00Z`).getUTCDay()];
  return v ? { ...v, from: core.atTimeIn(day, v.start, tz), to: core.atTimeIn(day, v.end, tz) } : null;
}

// Today's cached summary, refreshed if older than a minute.
async function dayData(ctx, day, tz, now) {
  let data = await store.get(K(ctx.uid, `day:${day}`));
  if ((!data || now - data.fetchedAt > 60000) && (await store.lock(K(ctx.uid, 'poll'), 8000))) {
    data = await core.buildDay(ctx, day, tz, true).catch(() => data);
  }
  return data;
}

const runningOn = (state, day, tz) => (state.running && core.ymdIn(state.running.startedAt, tz) === day ? state.running : null);

// ---------- reminders ----------
async function evaluate(ctx, { tz, state, hb, source } = {}) {
  if (!(await store.lock(K(ctx.uid, 'evalgap'), source === 'cron' ? 2000 : 12000))) return;
  const p = await prefs.get(ctx.uid);
  if (hb === undefined) hb = await store.get(K(ctx.uid, 'hb'));
  if (tz && tz !== p.tz && core.tzOf({ tz }) === tz) await prefs.update(ctx.uid, { tz }); // for runs without a browser
  tz = core.tzOf({ tz: tz || p.tz || hb?.tz });
  const now = Date.now();
  const day = core.ymdIn(now, tz);
  state = state || (await core.getState(ctx));
  const fresh = !!hb && now - hb.at < 60000;
  const data = await dayData(ctx, day, tz, now);
  if (!data) return;
  const run = runningOn(state, day, tz);
  const total = data.totalMinutes * 60 + (run && fresh ? (now - run.startedAt) / 1000 : 0);

  const rtKey = K(ctx.uid, `rt:${day}`);
  const rt = (await store.get(rtKey)) || { sent: {}, peak: 0, lastRun: null };
  const out = [];
  const fire = (key, a) => { if (rt.sent[key]) return; rt.sent[key] = now; out.push({ day, kind: key.split(':')[0], ...a }); };
  rt.peak = Math.max(rt.peak || 0, total);
  const shift = shiftFor(await store.get(K(ctx.uid, 'shift')), day, tz);

  // timer started: is it really yours?
  const prev = rt.lastRun;
  if (run && prev?.startedAt !== run.startedAt) {
    const chk = (await core.checkTasks(ctx, [run.taskGid]).catch(() => ({})))[run.taskGid];
    if (chk && !chk.ok) fire(`own:${run.startedAt}`, { title: 'Are you sure this is your task?', body: `${run.taskName || 'This ticket'} — ${chk.reasons.join(' · ')}` });
  }
  // timer stopped (a suspected stop waits until it's confirmed)
  const pendingStop = prev && state.suspect?.startedAt === prev.startedAt;
  if (prev && prev.startedAt !== run?.startedAt && !pendingStop) {
    if (shift && total < MIN_SEC && now >= shift.to - 30 * MIN && now < shift.to) fire('stopLate', { title: `Timer stopped at ${hm(total)} — under 7h`, body: LINES.low });
    const said = (await core.commentsFor(ctx, [prev.gid], day, tz, [prev.gid]).catch(() => ({})))[prev.gid];
    if (said === false) fire(`cmt:${prev.startedAt}`, { title: LINES.comment, body: prev.name || 'This ticket' });
  }
  rt.lastRun = run ? { gid: run.taskGid, startedAt: run.startedAt, name: run.taskName } : pendingStop ? prev : null;

  // 7h / 8h (jumping past 8h sends only the 8h one)
  if (total >= GOAL_SEC) { if (!rt.sent.h8) rt.sent.h7 ||= now; fire('h8', { title: '8h logged — that’s enough for today', body: LINES.over }); }
  else if (total >= MIN_SEC) fire('h7', { title: '7h logged ✦ bare minimum done', body: LINES.ok });

  if (shift && now >= shift.to) {
    if (now - shift.to < 15 * MIN && rt.peak < MIN_SEC) fire('shiftEnd', { title: `Shift over — ${hm(total)} logged, under 7h`, body: LINES.low });
    if (now - shift.to < 6 * H && !rt.sent.cmtEnd) {
      rt.sent.cmtEnd = now;
      const miss = data.tasks.filter((t) => t.comment === false);
      if (miss.length) out.push({ day, kind: 'cmtEnd', title: `💬 ${miss.length} ticket${miss.length === 1 ? '' : 's'} with no comment from you today`, body: `${LINES.comment} ${miss.slice(0, 4).map((t) => t.name).join(' · ')}` });
    }
  }

  if (data.lunch && data.lunchMinutes > 0 && now >= core.atTimeIn(day, data.lunch.end, tz)) {
    fire('lunch', { title: LINES.lunch, body: `${hm(data.lunchMinutes * 60)} of your logged time falls in lunch (${data.lunch.start}–${data.lunch.end}). Open Tracket to remove it.` });
  }

  await store.set(rtKey, rt, 3 * 24 * 3600);
  for (const a of out) await addAlert(ctx.uid, a);

  if (p.report.on) await require('./report').maybeSend(ctx, { p, tz, now, day, shift, source }).catch(() => {});
}

// ---------- auto mode ----------
// An action is offered with a 25s countdown (Asana tab + Tracket + push).
// Whoever takes lock:autoclaim:<id> first decides it: a tab claiming it to act
// (after the countdown), a Deny, or the timeout (no tab answered → missed).
const FINAL = ['done', 'denied', 'missed', 'failed', 'skipped'];
const claimKey = (uid, id) => K(uid, `autoclaim:${id}`);
const statusOf = async (uid, id) => (await store.get(K(uid, `autost:${id}`))) || { status: 'pending' };
const setStatus = (uid, id, status, extra = {}) => store.set(K(uid, `autost:${id}`), { status, at: Date.now(), ...extra }, 3 * 24 * 3600);
const decide = (uid, id) => store.lock(claimKey(uid, id), 3 * 24 * 3600e3);

async function current(uid) {
  const rec = await store.get(K(uid, 'autonow'));
  if (!rec) return null;
  const st = await statusOf(uid, rec.id);
  return { ...rec, status: st.status, serverNow: Date.now() };
}

const TITLES = {
  cap: (r) => [`Stopping your timer in 25s — ${r.hours}h reached`, `Timer stopped — ${r.hours}h reached`],
  lunchStop: () => ['Lunch time — stopping your timer in 25s', 'Timer stopped for lunch 🍽'],
  lunchResume: (r) => [`Lunch over — restarting “${r.name || 'your last ticket'}” in 25s`, `Timer restarted on “${r.name || 'your last ticket'}”`],
};

async function autoStep(ctx, { tz, state }) {
  if (!(await store.lock(K(ctx.uid, 'autogap'), 2500))) return;
  const p = await prefs.get(ctx.uid);
  const now = Date.now();
  tz = core.tzOf({ tz: tz || p.tz });
  const day = core.ymdIn(now, tz);
  const key = K(ctx.uid, `auto:${day}`);
  const A = (await store.get(key)) || {};
  let dirty = false, busy = false;

  for (const r of Object.values(A)) {
    if (r.final) continue;
    let st = await statusOf(ctx.uid, r.id);
    if (st.status === 'pending' && now > r.deadline + 45000 && (await decide(ctx.uid, r.id))) {
      st = { status: 'missed' };
      await setStatus(ctx.uid, r.id, 'missed');
      // (found much later, e.g. the next morning: not worth a notification)
      if (now - r.deadline < 10 * MIN) await addAlert(ctx.uid, { day, kind: 'auto', title: `Auto mode couldn’t ${r.action === 'stop' ? 'stop' : 'restart'} your timer`, body: 'No Asana tab answered in time. Do it by hand.' });
    }
    if (st.status === 'running' && now > (st.at || r.deadline) + 60000) {
      st = { status: 'failed' };
      await setStatus(ctx.uid, r.id, 'failed', { error: 'no answer from the Asana tab' });
      await addAlert(ctx.uid, { day, kind: 'auto', title: `Auto mode couldn’t ${r.action === 'stop' ? 'stop' : 'restart'} your timer`, body: 'The Asana tab didn’t confirm it. Check your timer.' });
    }
    if (FINAL.includes(st.status)) { r.final = st.status; dirty = true; } else busy = true;
  }
  if (!busy) {
    const hasAuto = p.auto.cap.on || (p.auto.lunch && p.lunch);
    const run = runningOn(state, day, tz);
    let offer = null;
    if (hasAuto) {
      const L = p.lunch && { from: core.atTimeIn(day, p.lunch.start, tz), to: core.atTimeIn(day, p.lunch.end, tz) };
      if (p.auto.cap.on && run && !A.cap) {
        const data = await dayData(ctx, day, tz, now);
        const total = (data?.totalMinutes || 0) * 60 + (now - run.startedAt) / 1000;
        if (data && total >= p.auto.cap.hours * 3600) offer = { kind: 'cap', action: 'stop', hours: p.auto.cap.hours };
      }
      if (!offer && p.auto.lunch && L && run && now >= L.from && now < L.to && !A.lunchStop) {
        offer = { kind: 'lunchStop', action: 'stop', gid: run.taskGid, name: run.taskName, url: run.url };
      }
      if (!offer && p.auto.lunch && L && A.lunchStop?.final === 'done' && !state.running && !state.suspect && now >= L.to && now < L.to + 30 * MIN && !A.lunchResume) {
        offer = { kind: 'lunchResume', action: 'start', gid: A.lunchStop.gid, name: A.lunchStop.name, url: A.lunchStop.url };
      }
    }
    if (offer) {
      const rec = { ...offer, id: `${day}.${offer.kind}`, issuedAt: now, deadline: now + COUNTDOWN };
      rec.title = TITLES[offer.kind](rec)[0];
      A[offer.kind] = rec; dirty = true;
      await store.set(K(ctx.uid, 'autonow'), rec, 180);
      await addAlert(ctx.uid, { day, kind: 'autoOffer', title: rec.title, body: 'Deny it in your Asana tab or in Tracket.' }, { autoId: rec.id, requireInteraction: true });
    }
  }
  if (dirty) await store.set(key, A, 3 * 24 * 3600);
}

// op: 'deny' | 'claim' | 'result'
async function autoOp(ctx, { id, op, ok, error }) {
  const uid = ctx.uid;
  const rec = await store.get(K(uid, 'autonow'));
  if (!rec || rec.id !== id) return { ok: false, status: 'gone' };
  const day = id.split('.')[0];
  if (op === 'deny') {
    if (!(await decide(uid, id))) return { ok: false, status: (await statusOf(uid, id)).status };
    await setStatus(uid, id, 'denied');
    await store.del(K(uid, 'autonow'));
    return { ok: true, status: 'denied' };
  }
  if (op === 'claim') {
    if (Date.now() < rec.deadline - 2000) return { go: false, status: 'pending' };
    const s = await core.getState(ctx);
    const valid = rec.action === 'stop' ? !!s.running : !s.running && !s.suspect;
    if (!(await decide(uid, id))) return { go: false, status: (await statusOf(uid, id)).status };
    if (!valid) { await setStatus(uid, id, 'skipped'); await store.del(K(uid, 'autonow')); return { go: false, status: 'skipped' }; }
    await setStatus(uid, id, 'running');
    return { go: true, rec };
  }
  if (op === 'result') {
    const st = await statusOf(uid, id);
    if (st.status !== 'running') return { ok: false, status: st.status };
    await setStatus(uid, id, ok ? 'done' : 'failed', ok ? {} : { error: String(error || 'unknown').slice(0, 140) });
    await store.del(K(uid, 'autonow'));
    const [, done] = TITLES[rec.kind](rec);
    await addAlert(uid, ok
      ? { day, kind: 'auto', title: done, body: 'Auto mode' }
      : { day, kind: 'auto', title: `Auto mode couldn’t ${rec.action === 'stop' ? 'stop' : 'restart'} your timer`, body: `${String(error || 'Asana’s button wasn’t found').slice(0, 140)}. Do it by hand.` });
    return { ok: true };
  }
  return { ok: false };
}

// The day's auto actions and how they ended (for the report).
async function autoLog(uid, day) {
  const A = (await store.get(K(uid, `auto:${day}`))) || {};
  const out = [];
  for (const r of Object.values(A)) out.push({ kind: r.kind, title: TITLES[r.kind](r)[1], status: r.final || (await statusOf(uid, r.id)).status });
  return out;
}

module.exports = { evaluate, autoStep, autoOp, current, feed, addAlert, markSeen, autoLog, shiftFor, LINES, hm };
