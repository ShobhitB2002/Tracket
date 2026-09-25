// Server-side reminders and auto mode. Runs without any browser open, so
// alerts reach phones (Web Push), the menu bar and the daily email.
//
// Triggers (serverless has no timers): every userscript heartbeat (/api/event),
// every dashboard poll (/api/live), and /api/cron (an external scheduler).
//   evaluate() — reminders + daily report; at most every ~12s per member
//   autoStep() — auto mode; on userscript heartbeats and on menu bar polls
//                that say they can act (act=1), since only an open Asana tab
//                (or the Mac menu bar driving one) can press Asana's timer buttons
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
// How long an offer waits for a tab (or the menu bar) to act. Safari can
// freeze background tabs for minutes, so a late stop beats no stop.
const PATIENCE = 10 * MIN;
const IDLE_MS = 20 * MIN;
const FAILSAFE_COUNTDOWN = 10000;
const bad = (msg) => { const e = new Error(msg); e.status = 400; return e; };

// The owner's lines (grammar tidied, meaning kept).
const LINES = {
  ok: 'Hey, you’ve logged the bare minimum. You can tap out now if you want.',
  over: 'Are you sure you know what you’re doing? That’s enough work for today!',
  low: 'Oh no! Are you sure you want to log off now? Do you really want to get that email?',
  comment: 'Dude, you forgot to mention what you did on this ticket. All good?',
  lunch: 'Your timer ran during lunch today. Want to fix that?',
};

const pad = (n) => String(n).padStart(2, '0');
const hm = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h ? `${h}h ${pad(m)}m` : `${m}m`; };
// the daily limit, e.g. 7 → "7h", 7.5 → "7h 30m"
const capLabel = (hours) => { const m = Math.round(hours * 60); return m % 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m / 60}h`; };

// ---------- feed: u:<id>:alerts = { items: [{ id, day, kind, title, body }], seen } ----------
async function feed(uid) { return (await store.get(K(uid, 'alerts'))) || { items: [], seen: 0 }; }

async function addAlert(uid, a, pushExtra = {}) {
  const f = await feed(uid);
  const item = { id: Math.max(Date.now(), (f.items[f.items.length - 1]?.id || 0) + 1), day: a.day, kind: a.kind, title: a.title, body: a.body || '' };
  f.items = [...f.items, item].slice(-60);
  await store.set(K(uid, 'alerts'), f, 8 * 24 * 3600);
  await store.set(K(uid, 'alertsHead'), { last: item.id, seen: f.seen || 0 }, 8 * 24 * 3600); // cheap "anything new?" for polls
  await push.sendTo(uid, { title: item.title, body: item.body, tag: a.tag || `${item.kind}-${item.id}`, ...pushExtra }).catch(() => {});
  return item;
}

async function markSeen(uid, upTo) {
  const f = await feed(uid);
  const to = Math.min(Number(upTo) || 0, f.items[f.items.length - 1]?.id || 0);
  if (to > (f.seen || 0)) {
    f.seen = to;
    await store.set(K(uid, 'alerts'), f, 8 * 24 * 3600);
    await store.set(K(uid, 'alertsHead'), { last: f.items[f.items.length - 1]?.id || 0, seen: to }, 8 * 24 * 3600);
  }
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
  // at most about once a minute per member (in-memory check first: no database call)
  if (source !== 'cron' && !store.throttle(`ev:${ctx.uid}`, 50000)) return;
  if (!(await store.lock(K(ctx.uid, 'evalgap'), source === 'cron' ? 2000 : 45000))) return;
  const p = await prefs.get(ctx.uid);
  if (hb === undefined) hb = await store.get(K(ctx.uid, 'hb'));
  if (tz && tz !== p.tz && core.tzOf({ tz }) === tz) await prefs.update(ctx.uid, { tz }); // for runs without a browser
  tz = core.tzOf({ tz: tz || p.tz || hb?.tz });
  const now = Date.now();
  const day = core.ymdIn(now, tz);
  state = state || (await core.getState(ctx));
  const fresh = !!hb && now - hb.at < core.FRESH_MS;
  const data = await dayData(ctx, day, tz, now);
  if (!data) return;
  const run = runningOn(state, day, tz);
  const total = data.totalMinutes * 60 + (run && fresh ? (now - run.startedAt) / 1000 : 0);

  const rtKey = K(ctx.uid, `rt:${day}`);
  const rt = (await store.get(rtKey)) || { sent: {}, peak: 0, lastRun: null };
  const out = [];
  const fire = (key, a) => { if (rt.sent[key]) return; rt.sent[key] = now; out.push({ day, kind: key.split(':')[0], ...a }); };
  rt.peak = Math.max(rt.peak || 0, total);
  const shift = shiftFor(await store.get(K(ctx.uid, 'shift'), { cache: 60000 }), day, tz);

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

  // 💤 no timer running for 20 min during the shift (only when an Asana tab reports, so we really know)
  const inLunch = p.lunch && now >= core.atTimeIn(day, p.lunch.start, tz) && now < core.atTimeIn(day, p.lunch.end, tz);
  if (!run && fresh && shift && now >= shift.from && now < shift.to && !inLunch) {
    rt.idleFrom = rt.idleFrom || now;
    if (p.nudge.idle && now - rt.idleFrom >= IDLE_MS) fire(`idle:${rt.idleFrom}`, { title: 'No timer running 👀', body: `Nothing has been ticking for ${hm((now - rt.idleFrom) / 1000)} of your shift. Forgot to start one?` });
  } else rt.idleFrom = null;
  // ⏰ a timer left running after the shift (or after 21:00 without one)
  if (run && p.nudge.late && (shift ? now >= shift.to + 15 * MIN : now >= core.atTimeIn(day, '21:00', tz))) {
    const since = new Date(run.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
    fire(`late:${run.startedAt}`, { title: 'Timer still running ⏰', body: `${run.taskName || 'Your timer'} has been running since ${since}${shift ? ', and your shift is over' : ''}. Still working?` });
  }

  if (data.lunch && data.lunchMinutes > 0 && now >= core.atTimeIn(day, data.lunch.end, tz)) {
    fire('lunch', { title: LINES.lunch, body: `${hm(data.lunchMinutes * 60)} of your logged time falls in lunch (${data.lunch.start}–${data.lunch.end}). Open Tracket to remove it.` });
  }

  await store.set(rtKey, rt, 3 * 24 * 3600);
  for (const a of out) await addAlert(ctx.uid, a);

  if (p.report.on) await require('./report').maybeSend(ctx, { p, tz, now, day, shift, source }).catch(() => {});
  if (p.report.weekly) await require('./report').maybeSendWeekly(ctx, { p, tz, now, day, shift }).catch(() => {});
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

// The action in progress (autonow carries its status: pending → running).
async function current(uid, rec) {
  if (rec === undefined) rec = await store.get(K(uid, 'autonow'));
  return rec ? { ...rec, status: rec.status || 'pending', serverNow: Date.now() } : null;
}

const TITLES = {
  cap: (r) => [`Stopping your timer in 25s — ${capLabel(r.hours)} reached`, `Timer stopped — ${capLabel(r.hours)} reached`],
  lunchStop: () => ['Lunch time — stopping your timer in 25s', 'Timer stopped for lunch 🍽'],
  lunchResume: (r) => [`Lunch over — restarting “${r.name || 'your last ticket'}” in 25s`, `Timer restarted on “${r.name || 'your last ticket'}”`],
  failsafe: (r) => [`Failsafe: stopping your timer in 10s — ${r.reason}`, `Failsafe stopped your timer — ${r.reason}`],
  manual: (r) => r.action === 'stop' ? ['Stopping your timer…', 'Timer stopped']
    : [`${r.action === 'switch' ? 'Switching to' : 'Starting'} “${r.name || 'your ticket'}”…`, `Timer ${r.action === 'switch' ? 'switched to' : 'started on'} “${r.name || 'your ticket'}”`],
};
const verbOf = (r) => (r.action === 'stop' ? 'stop' : r.action === 'switch' ? 'switch' : r.kind === 'manual' ? 'start' : 'restart');

// Returns { offered } (a newly offered action, if any) and { beatIn } (ms) when
// the daily limit is close, so the Asana tab reports more often and the stop
// lands on time. `autonow` = the caller's read of the action in progress.
async function autoStep(ctx, { tz, state, autonow }) {
  const p = await prefs.get(ctx.uid);
  // nothing switched on and nothing in progress → no database work at all
  if (!p.auto.cap.on && !(p.auto.lunch && p.lunch) && !p.auto.failsafe && !autonow) return {};
  if (!store.throttle(`auto:${ctx.uid}`, 2000)) return {};
  const now = Date.now();
  tz = core.tzOf({ tz: tz || p.tz });
  const day = core.ymdIn(now, tz);
  const key = K(ctx.uid, `auto:${day}`);
  const A = (await store.get(key)) || {};
  let dirty = false, busy = false, offered = null, beatIn = null;

  for (const r of Object.values(A)) {
    if (r.final) continue;
    let st = await statusOf(ctx.uid, r.id);
    const patience = r.patience || PATIENCE;
    if (st.status === 'pending' && now > r.deadline + patience && (await decide(ctx.uid, r.id))) {
      st = { status: 'missed' };
      await setStatus(ctx.uid, r.id, 'missed');
      // (found much later, e.g. the next morning: not worth a notification)
      if (now - r.deadline < patience + 10 * MIN) await addAlert(ctx.uid, { day, kind: 'auto', title: `${r.kind === 'manual' ? 'Tracket' : 'Auto mode'} couldn’t ${verbOf(r)} your timer`, body: r.kind === 'manual' ? 'No Asana tab answered. Open Asana (or reload its tab) and try again.' : `No Asana tab answered for ${PATIENCE / MIN} minutes. Do it by hand.` });
    }
    // (90s: the tab may first have to open the ticket to reach Asana's Stop button)
    if (st.status === 'running' && now > (st.at || r.deadline) + 90000) {
      st = { status: 'failed' };
      await setStatus(ctx.uid, r.id, 'failed', { error: 'no answer from the Asana tab' });
      await addAlert(ctx.uid, { day, kind: 'auto', title: `${r.kind === 'manual' ? 'Tracket' : 'Auto mode'} couldn’t ${verbOf(r)} your timer`, body: 'The Asana tab didn’t confirm it. Check your timer.' });
    }
    if (FINAL.includes(st.status)) { r.final = st.status; dirty = true; } else busy = true;
  }
  if (!busy) {
    const hasAuto = p.auto.cap.on || (p.auto.lunch && p.lunch) || p.auto.failsafe;
    const run = runningOn(state, day, tz);
    let offer = null;
    if (hasAuto) {
      const L = p.lunch && { from: core.atTimeIn(day, p.lunch.start, tz), to: core.atTimeIn(day, p.lunch.end, tz) };
      let capLeft = null;
      if (p.auto.cap.on && run) {
        const data = await dayData(ctx, day, tz, now);
        if (data) capLeft = p.auto.cap.hours * 3600 - ((data.totalMinutes || 0) * 60 + (now - run.startedAt) / 1000);
        if (capLeft !== null && capLeft > 0 && capLeft < 180) beatIn = 10000;
      }
      // Failsafe: no timer outside the shift, none past the daily limit — every run, no Deny
      if (p.auto.failsafe && run && !A[`fs${run.startedAt}`]) {
        const sh = shiftFor(await store.get(K(ctx.uid, 'shift'), { cache: 60000 }), day, tz);
        const outside = !sh || now < sh.from || now >= sh.to;
        if (sh && now < sh.to && sh.to - now < 180) beatIn = 10000;
        const reason = outside ? (sh ? 'outside your shift hours' : 'no shift today') : capLeft !== null && capLeft <= 0 ? `${capLabel(p.auto.cap.hours)} limit reached` : null;
        if (reason) offer = { kind: 'failsafe', key: `fs${run.startedAt}`, action: 'stop', noDeny: true, countdown: FAILSAFE_COUNTDOWN, reason, gid: run.taskGid, stopGid: run.taskGid, name: run.taskName, url: run.url };
      }
      if (!offer && !p.auto.failsafe && p.auto.cap.on && run && !A.cap && capLeft !== null && capLeft <= 0) {
        offer = { kind: 'cap', action: 'stop', hours: p.auto.cap.hours, gid: run.taskGid, stopGid: run.taskGid, name: run.taskName, url: run.url };
      }
      if (!offer && p.auto.lunch && L && run && now >= L.from && now < L.to && !A.lunchStop) {
        offer = { kind: 'lunchStop', action: 'stop', gid: run.taskGid, stopGid: run.taskGid, name: run.taskName, url: run.url };
      }
      if (!offer && p.auto.lunch && L && A.lunchStop?.final === 'done' && !state.running && !state.suspect && now >= L.to && now < L.to + 30 * MIN && !A.lunchResume) {
        offer = { kind: 'lunchResume', action: 'start', gid: A.lunchStop.gid, name: A.lunchStop.name, url: A.lunchStop.url };
      }
    }
    if (offer) {
      const key = offer.key || offer.kind;
      const rec = { ...offer, id: `${day}.${key}`, issuedAt: now, deadline: now + (offer.countdown || COUNTDOWN) };
      rec.title = TITLES[offer.kind](rec)[0];
      A[key] = rec; dirty = true;
      // two requests at once must not offer it twice
      if (!(await store.lock(K(ctx.uid, `autoissue:${rec.id}`), 3 * 24 * 3600e3))) { delete A[key]; return {}; }
      await store.set(K(ctx.uid, 'autonow'), rec, 180);
      offered = rec;
      await addAlert(ctx.uid, { day, kind: 'autoOffer', title: rec.title, body: rec.noDeny ? 'Failsafe is on, so this can’t be denied.' : 'Deny it in your Asana tab or in Tracket.' }, rec.noDeny ? {} : { autoId: rec.id, requireInteraction: true });
    }
  }
  if (dirty) await store.set(key, A, 3 * 24 * 3600);
  return { offered, beatIn };
}

// op: 'deny' | 'claim' | 'result'
async function autoOp(ctx, { id, op, ok, error }) {
  const uid = ctx.uid;
  const rec = await store.get(K(uid, 'autonow'));
  if (!rec || rec.id !== id) return { ok: false, status: 'gone' };
  const day = id.split('.')[0];
  if (op === 'deny') {
    if (rec.noDeny) return { ok: false, status: 'locked' };
    if (!(await decide(uid, id))) return { ok: false, status: (await statusOf(uid, id)).status };
    await setStatus(uid, id, 'denied');
    await store.del(K(uid, 'autonow'));
    return { ok: true, status: 'denied' };
  }
  if (op === 'claim') {
    if (Date.now() < rec.deadline - 2000) return { go: false, status: 'pending' };
    const s = await core.getState(ctx);
    const valid = rec.action === 'stop' ? !!s.running : rec.action === 'switch' ? true : !s.running && !s.suspect;
    if (!(await decide(uid, id))) return { go: false, status: (await statusOf(uid, id)).status };
    if (!valid) { await setStatus(uid, id, 'skipped'); await store.del(K(uid, 'autonow')); return { go: false, status: 'skipped' }; }
    await setStatus(uid, id, 'running');
    await store.set(K(uid, 'autonow'), { ...rec, status: 'running' }, 180);
    return { go: true, rec };
  }
  if (op === 'result') {
    const st = await statusOf(uid, id);
    if (st.status !== 'running') return { ok: false, status: st.status };
    await setStatus(uid, id, ok ? 'done' : 'failed', ok ? {} : { error: String(error || 'unknown').slice(0, 140) });
    await store.del(K(uid, 'autonow'));
    const [, done] = TITLES[rec.kind](rec);
    const who = rec.kind === 'manual' ? 'Tracket' : 'Auto mode';
    if (!ok) await addAlert(uid, { day, kind: 'auto', title: `${who} couldn’t ${verbOf(rec)} your timer`, body: `${String(error || 'Asana’s button wasn’t found').slice(0, 140)}. Do it by hand.` });
    else if (rec.kind !== 'manual') await addAlert(uid, { day, kind: 'auto', title: done, body: rec.kind === 'failsafe' ? 'Failsafe' : 'Auto mode' });
    return { ok: true };
  }
  return { ok: false };
}

// ---------- manual start / stop / switch (the dashboard's button, the menu bar) ----------
// Same pipeline as auto mode — claim → an Asana tab (or the menu bar) presses
// Asana's button → result — with no countdown or Deny, as often as you like.
const MANUAL_PATIENCE = 90000;
async function command(ctx, { action, gid } = {}) {
  if (!['start', 'stop'].includes(action)) throw bad('Unknown action');
  const uid = ctx.uid, now = Date.now();
  const p = await prefs.get(uid);
  const tz = core.tzOf({ tz: p.tz });
  const day = core.ymdIn(now, tz);
  const busy = await store.get(K(uid, 'autonow'));
  if (busy && now < busy.deadline + (busy.patience || PATIENCE)) throw bad(`Busy: ${busy.title} Try again in a moment.`);
  const state = await core.getState(ctx);
  const run = runningOn(state, day, tz) || state.running;
  let rec;
  if (action === 'stop') {
    if (!run) throw bad('Nothing is running.');
    rec = { action: 'stop', gid: run.taskGid, stopGid: run.taskGid, name: run.taskName, url: run.url };
  } else {
    if (p.auto.failsafe) {
      const sh = shiftFor(await store.get(K(uid, 'shift'), { cache: 60000 }), day, tz);
      if (!sh || now < sh.from || now >= sh.to) throw bad('Failsafe is on, and you’re outside your shift hours.');
    }
    const t = gid ? await core.ticketInfo(ctx, gid) : await core.nextTicket(ctx, tz);
    if (!t) throw bad('No recent open ticket to start. Start one in Asana first.');
    if (run && String(run.taskGid) === String(t.gid)) throw bad('That ticket is already running.');
    rec = { action: run ? 'switch' : 'start', gid: t.gid, name: t.name, url: t.url, stopGid: run?.taskGid };
  }
  const key = `m${now}`;
  rec = { ...rec, kind: 'manual', key, id: `${day}.${key}`, issuedAt: now, deadline: now, patience: MANUAL_PATIENCE };
  rec.title = TITLES.manual(rec)[0];
  const dk = K(uid, `auto:${day}`);
  const A = (await store.get(dk)) || {};
  A[key] = rec;
  await store.set(dk, A, 3 * 24 * 3600);
  await store.set(K(uid, 'autonow'), rec, 180);
  return current(uid, rec);
}

// The day's auto actions and how they ended (for the report).
async function autoLog(uid, day) {
  const A = (await store.get(K(uid, `auto:${day}`))) || {};
  const out = [];
  for (const r of Object.values(A)) if (r.kind !== 'manual') out.push({ kind: r.kind, title: TITLES[r.kind](r)[1], status: r.final || (await statusOf(uid, r.id)).status });
  return out;
}

module.exports = { evaluate, autoStep, autoOp, command, current, feed, addAlert, markSeen, autoLog, shiftFor, LINES, hm, capLabel, PATIENCE };
