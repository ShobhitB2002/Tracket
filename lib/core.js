// Tracket core: talks to Asana and keeps each member's running-timer state.
// Every function takes a ctx = { uid, pat } and only touches that member's
// keys (u:<uid>:*), so members are fully isolated from each other.
const store = require('./store');
const prefs = require('./prefs');

const API = 'https://app.asana.com/api/1.0';
const K = (ctx, name) => `u:${ctx.uid}:${name}`;
// The userscript's leader tab reports every 60s (instantly on a start/stop);
// a report newer than this means an Asana tab is open and connected.
const FRESH_MS = 150000;

// ---------- time zones ----------
// Serverless runs in UTC, so "today" is always computed in the viewer's zone.
function tzOf(q = {}) {
  const tz = q.tz || process.env.TRACKET_TZ || 'UTC';
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return 'UTC'; }
}
const ymdIn = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
function dayStartMs(day, tz) {
  const guess = Date.parse(`${day}T00:00:00Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(guess).map((x) => [x.type, x.value]));
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess;
  return guess - offset;
}
// 'HH:MM' on a given day, in the member's zone
const atTimeIn = (day, hhmm, tz) => { const [h, m] = hhmm.split(':').map(Number); return dayStartMs(day, tz) + h * 3600e3 + m * 60e3; };

// ---------- Asana ----------
async function asana(ctx, p, { method = 'GET', body } = {}) {
  const headers = { Authorization: `Bearer ${ctx.pat}`, Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Asana: ${out?.errors?.[0]?.message || res.status}`);
    err.status = res.status;
    err.asana = true;
    throw err;
  }
  return out;
}

async function asanaAll(ctx, p) {
  const out = [];
  const sep = p.includes('?') ? '&' : '?';
  let url = `${p}${sep}limit=100`;
  for (let i = 0; i < 20 && url; i++) {
    const body = await asana(ctx, url);
    out.push(...(body.data || []));
    const off = body.next_page?.offset;
    url = off ? `${p}${sep}limit=100&offset=${off}` : null;
  }
  return out;
}

async function me(ctx) {
  let u = await store.get(K(ctx, 'me'));
  if (!u) {
    u = (await asana(ctx, '/users/me?opt_fields=gid,name,workspaces.name')).data;
    await store.set(K(ctx, 'me'), u, 6 * 3600);
  }
  return u;
}

// Checks a token before we store it; returns the Asana user.
async function verifyPat(pat) {
  const u = (await asana({ pat }, '/users/me?opt_fields=gid,name,email,workspaces.name')).data;
  return u;
}

const ENTRY_FIELDS = 'duration_minutes,entered_on,created_at,created_by.gid,attributable_to.gid,task.gid,task.name,task.permalink_url';

// One call for all of a day's entries (newer Asana API).
const entriesDirect = (ctx, ws, user, day) => asanaAll(ctx, `/time_tracking_entries?workspace=${ws}&user=${user}` +
  `&entered_on_start_date=${day}&entered_on_end_date=${day}&opt_fields=${ENTRY_FIELDS}`);

// Fallback for workspaces without that endpoint: search tasks touched that day
// (plus tasks the userscript has seen), then read each task's entries.
async function entriesViaTasks(ctx, ws, user, day, tz) {
  const since = new Date(dayStartMs(day, tz)).toISOString();
  const candidates = new Map();
  for (const q of [`assignee.any=me&modified_at.after=${since}`, `followers.any=me&modified_at.after=${since}`]) {
    try {
      for (const t of await asanaAll(ctx, `/workspaces/${ws}/tasks/search?${q}&opt_fields=name,permalink_url&sort_by=modified_at`)) candidates.set(t.gid, t);
    } catch { /* search is a paid feature */ }
  }
  for (const [gid, t] of Object.entries((await store.get(K(ctx, `tasks:${day}`))) || {}))
    if (!candidates.has(gid)) candidates.set(gid, { gid, name: t.name, permalink_url: t.url });

  const out = [];
  const list = [...candidates.values()];
  for (let i = 0; i < list.length; i += 8) {
    await Promise.all(list.slice(i, i + 8).map(async (t) => {
      try {
        for (const e of await asanaAll(ctx, `/tasks/${t.gid}/time_tracking_entries?opt_fields=${ENTRY_FIELDS}`)) {
          e.task = { gid: t.gid, name: e.task?.name || t.name, permalink_url: e.task?.permalink_url || t.permalink_url };
          out.push(e);
        }
      } catch {}
    }));
  }
  return out.filter((e) => e.entered_on === day && (e.created_by?.gid === user || e.attributable_to?.gid === user));
}

const directWorks = new Map(); // uid → whether the one-call endpoint works for them

async function fetchEntries(ctx, day, tz) {
  const user = await me(ctx);
  const entries = [];
  for (const ws of user.workspaces || []) {
    let got = null;
    if (directWorks.get(ctx.uid) !== false) {
      try { got = await entriesDirect(ctx, ws.gid, user.gid, day); directWorks.set(ctx.uid, true); }
      catch (e) { if (e.status === 400 || e.status === 404) directWorks.set(ctx.uid, false); else if (e.status === 402) got = []; else throw e; }
    }
    if (got === null) got = await entriesViaTasks(ctx, ws.gid, user.gid, day, tz);
    entries.push(...got);
  }
  return { user, entries };
}

// ---------- is this really your ticket? ----------
// OK = assigned to you AND Task Status is one of OK_STATUSES. A task without a
// Task Status field is judged on the assignee, but still flagged so you notice.
const STATUS_FIELD = 'task status';
const OK_STATUSES = ['in grooming', 'in development'];
const CHECK_TTL = 30000;

function judge(task, myGid) {
  const reasons = [];
  if (!task.assignee) reasons.push('Not assigned to anyone');
  else if (task.assignee.gid !== myGid) reasons.push(`Assigned to ${task.assignee.name || 'someone else'}`);
  const field = (task.custom_fields || []).find((f) => (f.name || '').trim().toLowerCase() === STATUS_FIELD);
  if (!field) reasons.push('No Task Status field — are you sure that’s acceptable?');
  else {
    const v = (field.enum_value?.name || field.display_value || '').trim();
    if (!v) reasons.push('Task Status is empty');
    else if (!OK_STATUSES.includes(v.toLowerCase())) reasons.push(`Task Status is “${v}”`);
  }
  return { ok: !reasons.length, reasons };
}

// Checks for several tasks, cached ~30s. Never throws: a task Asana won't
// give us is simply left unchecked (no false warnings).
async function checkTasks(ctx, gids, fresh = []) {
  gids = [...new Set(gids.filter((g) => g && !String(g).startsWith('name:') && g !== 'unknown'))];
  if (!gids.length) return {};
  const cache = (await store.get(K(ctx, 'chk'))) || {};
  const now = Date.now();
  const stale = gids.filter((g) => fresh.includes(g) || !cache[g] || now - cache[g].at > CHECK_TTL);
  if (stale.length) {
    const myGid = (await me(ctx)).gid;
    for (let i = 0; i < stale.length; i += 8) {
      await Promise.all(stale.slice(i, i + 8).map(async (g) => {
        try {
          const t = (await asana(ctx, `/tasks/${g}?opt_fields=assignee.gid,assignee.name,custom_fields.name,custom_fields.display_value,custom_fields.enum_value.name`)).data;
          cache[g] = { at: now, ...judge(t, myGid) };
        } catch { delete cache[g]; }
      }));
    }
    for (const [g, v] of Object.entries(cache)) if (now - v.at > 24 * 3600e3) delete cache[g];
    await store.set(K(ctx, 'chk'), cache, 24 * 3600);
  }
  const out = {};
  for (const g of gids) if (cache[g]) out[g] = { ok: cache[g].ok, reasons: cache[g].reasons };
  return out;
}

// ---------- did you comment on it? ----------
// For each ticket with time that day: did you post a comment on it that day?
// Yes is kept for the day; no is re-checked every 90s. Unknown (Asana error) → absent.
async function commentsFor(ctx, gids, day, tz, fresh = []) {
  gids = [...new Set(gids.filter((g) => g && !String(g).startsWith('name:') && g !== 'unknown'))];
  if (!gids.length) return {};
  const key = K(ctx, `cmt:${day}`);
  const cache = (await store.get(key)) || {};
  const now = Date.now();
  const stale = gids.filter((g) => fresh.includes(g) || !cache[g] || (!cache[g].ok && now - cache[g].at > 90000));
  if (stale.length) {
    const myGid = (await me(ctx)).gid;
    for (let i = 0; i < stale.length; i += 8) {
      await Promise.all(stale.slice(i, i + 8).map(async (g) => {
        try {
          const stories = await asanaAll(ctx, `/tasks/${g}/stories?opt_fields=resource_subtype,created_at,created_by.gid`);
          const ok = stories.some((s) => s.resource_subtype === 'comment_added' && s.created_by?.gid === myGid && ymdIn(Date.parse(s.created_at), tz) === day);
          cache[g] = { ok, at: now };
        } catch {}
      }));
    }
    await store.set(key, cache, 3 * 24 * 3600);
  }
  const out = {};
  for (const g of gids) if (cache[g]) out[g] = cache[g].ok;
  return out;
}

// ---------- lunch ----------
// Minutes of an entry that fall inside lunch. Only for entries made by a timer
// Tracket saw start (u:<id>:sess:<day>), since only those have a real start and
// end: start = created_at − duration. Manual entries are never judged.
function lunchMinutes(e, L, sessions, fixed) {
  if (!L || !e.gid || fixed[e.gid]) return 0;
  const end = Date.parse(e.created_at), start = end - (e.duration_minutes || 0) * 60000;
  if (!sessions.some((x) => x.gid === String(e.task?.gid) && Math.abs(x.start - start) < 3 * 60000)) return 0;
  return Math.floor(Math.max(0, Math.min(end, L.to) - Math.max(start, L.from)) / 60000);
}

// A day's summary, cached (today: 20s, past days: 5 min).
async function buildDay(ctx, day, tz, force) {
  const isNow = day === ymdIn(Date.now(), tz);
  const cached = await store.get(K(ctx, `day:${day}`));
  if (!force && cached && Date.now() - cached.fetchedAt < (isNow ? 20000 : 300000)) return cached;

  const { user, entries } = await fetchEntries(ctx, day, tz);
  if (isNow) await reconcileRunning(ctx, entries);

  const p = await prefs.get(ctx.uid);
  const L = p.lunch ? { ...p.lunch, from: atTimeIn(day, p.lunch.start, tz), to: atTimeIn(day, p.lunch.end, tz) } : null;
  const sessions = L ? (await store.get(K(ctx, `sess:${day}`))) || [] : [];
  const fixed = L ? (await store.get(K(ctx, 'lunchfix'))) || {} : {};

  const byTask = new Map();
  for (const e of entries) {
    const gid = e.task?.gid || 'unknown';
    const t = byTask.get(gid) || { gid, name: e.task?.name || 'Untitled task', url: e.task?.permalink_url || null, minutes: 0, lunchMin: 0, entries: [] };
    const lunchMin = lunchMinutes(e, L, sessions, fixed);
    t.minutes += e.duration_minutes || 0;
    t.lunchMin += lunchMin;
    t.entries.push({ gid: e.gid, minutes: e.duration_minutes || 0, createdAt: e.created_at, lunchMin });
    byTask.set(gid, t);
  }
  const tasks = [...byTask.values()].sort((a, b) => b.minutes - a.minutes);
  const gids = tasks.map((t) => t.gid);
  const [checks, comments] = await Promise.all([
    checkTasks(ctx, gids).catch(() => ({})),
    commentsFor(ctx, gids, day, tz).catch(() => ({})),
  ]);
  for (const t of tasks) { t.check = checks[t.gid] || null; if (t.gid in comments) t.comment = comments[t.gid]; }
  const payload = {
    date: day,
    user: { name: user.name },
    tasks,
    totalMinutes: tasks.reduce((s, t) => s + t.minutes, 0),
    lunch: L ? { start: L.start, end: L.end } : null,
    lunchMinutes: tasks.reduce((s, t) => s + t.lunchMin, 0),
    sig: JSON.stringify([L?.start, L?.end, tasks.map((t) => [t.gid, t.minutes, t.entries.length, t.name, t.check, t.comment, t.lunchMin])]),
    fetchedAt: Date.now(),
  };
  await store.set(K(ctx, `day:${day}`), payload, isNow ? 3600 : 24 * 3600);
  return payload;
}

// ---------- running timer ----------
// State: { running, suspect, ended[] }. Tabs report what they see; startedAt is
// Asana's own timer start (ms) so it identifies a timer exactly.
// - a newer start beats the current one; the replaced timer counts as ended
// - "stopped" only comes from the tab you're looking at, and is only final
//   once Asana has logged the entry (reconcileRunning) — background tabs go
//   stale in Asana and must never undo anything
// - an ended timer never comes back
const blank = () => ({ running: null, suspect: null, ended: [] });
const getState = async (ctx) => ({ ...blank(), ...((await store.get(K(ctx, 'state'))) || {}) });
const putState = (ctx, s) => { s.ended = (s.ended || []).slice(-100); return store.set(K(ctx, 'state'), s); };

async function taskName(ctx, gid) {
  const names = (await store.get(K(ctx, 'names'))) || {};
  if (names[gid]) return names[gid];
  try {
    const n = (await asana(ctx, `/tasks/${gid}?opt_fields=name`)).data.name;
    names[gid] = n;
    await store.set(K(ctx, 'names'), names, 7 * 24 * 3600);
    return n;
  } catch { return null; }
}

// Every timer start Tracket sees, so lunch time can be worked out later.
async function rememberSession(ctx, day, gid, start) {
  const ss = (await store.get(K(ctx, `sess:${day}`))) || [];
  if (ss.some((x) => x.start === start)) return;
  ss.push({ gid, start });
  await store.set(K(ctx, `sess:${day}`), ss.slice(-200), 3 * 24 * 3600);
}

async function rememberTask(ctx, day, gid, name, url) {
  const seen = (await store.get(K(ctx, `tasks:${day}`))) || {};
  if (seen[gid]?.name === name) return;
  seen[gid] = { name, url };
  await store.set(K(ctx, `tasks:${day}`), seen, 3 * 24 * 3600);
}

// `pre.state` lets the caller pass state it already read. Returns the new state.
async function onReport(ctx, { running, previous, visible, diag, tz }, pre = {}) {
  const s = pre.state ? { ...blank(), ...structuredClone(pre.state) } : await getState(ctx);
  const before = JSON.stringify(s);
  const cur = s.running;
  tz = tzOf({ tz });

  if (running?.taskGid && running.startedAt) {
    const start = Number(running.startedAt);
    const gid = String(running.taskGid);
    const known = (cur?.startedAt === start && cur.taskName) || (s.suspect?.startedAt === start && s.suspect.taskName);
    const r = { taskGid: gid, taskName: running.taskName || known || null, url: running.url || `https://app.asana.com/0/0/${gid}/f`, startedAt: start };
    if (!r.taskName && !gid.startsWith('name:')) r.taskName = await taskName(ctx, gid);

    let ended = s.ended.includes(start);
    if (s.suspect?.startedAt === start) {
      if (visible === false) { ended = true; s.suspect.seenAfter = Date.now(); }
      else s.suspect = null; // the tab you're looking at still shows it: false alarm
    }
    if (!ended && (!cur || start >= cur.startedAt)) {
      if (cur && cur.startedAt !== start) s.ended.push(cur.startedAt);
      s.running = r;
      if (!cur || cur.startedAt !== start) {
        await rememberTask(ctx, ymdIn(start, tz), gid, r.taskName, r.url);
        await rememberSession(ctx, ymdIn(start, tz), gid, start);
        await checkTasks(ctx, [gid], [gid]).catch(() => {}); // fresh, so the start alert is right
      }
    }
  } else if (visible !== false && previous?.startedAt && cur && Number(previous.startedAt) === cur.startedAt) {
    s.suspect = { ...cur, stopAt: Date.now() };
    s.running = null;
  }
  if (JSON.stringify(s) !== before) await putState(ctx, s); // most heartbeats change nothing
  await store.set(K(ctx, 'hb'), { at: Date.now(), diag: diag || null, tz }, 24 * 3600);
  return s;
}

// If Asana logged an entry for the running (or suspected-stopped) timer after
// it started, that timer is over — also covers stopping from another device.
async function reconcileRunning(ctx, entries) {
  const s = await getState(ctx);
  const loggedAfter = (t) => entries.some((e) =>
    (String(e.task?.gid) === t.taskGid || (t.taskGid.startsWith('name:') && e.task?.name?.trim() === t.taskName)) &&
    Date.parse(e.created_at) > t.startedAt + 5000);
  let dirty = false;
  if (s.suspect && loggedAfter(s.suspect)) { s.ended.push(s.suspect.startedAt); s.suspect = null; dirty = true; }
  if (s.running && loggedAfter(s.running)) { s.ended.push(s.running.startedAt); s.running = null; dirty = true; }
  if (dirty) await putState(ctx, s);
}

// A suspected stop that Asana never confirmed within 25s: for a long timer
// that tabs still show, it was a false alarm → restore. Otherwise it's over.
async function settleSuspect(ctx) {
  const s = await getState(ctx);
  const sp = s.suspect;
  if (!sp || Date.now() - sp.stopAt < 25000) return;
  if (!s.running && sp.stopAt - sp.startedAt > 120000 && sp.seenAfter > sp.stopAt) {
    const { stopAt, seenAfter, ...back } = sp;
    s.running = back;
  } else s.ended.push(sp.startedAt);
  s.suspect = null;
  await putState(ctx, s);
}

const runningToday = (r, tz) => (r && ymdIn(r.startedAt, tz) === ymdIn(Date.now(), tz) ? r : null);
async function withCheck(ctx, r) {
  if (!r) return null;
  const c = await checkTasks(ctx, [r.taskGid]).catch(() => ({}));
  return { ...r, check: c[r.taskGid] || null };
}

// ---------- handlers (ctx = { uid, pat }) ----------
const validDay = (d, todayStr) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') && d <= todayStr ? d : todayStr);

async function today(ctx, query) {
  const tz = tzOf(query);
  const todayStr = ymdIn(Date.now(), tz);
  const day = validDay(query.date, todayStr);
  const data = await buildDay(ctx, day, tz, 'force' in query);
  const s = await getState(ctx);
  const hb = await store.get(K(ctx, 'hb'));
  return { ...data, running: day === todayStr ? await withCheck(ctx, runningToday(s.running, tz)) : null, lastHeartbeat: hb?.at || 0, serverNow: Date.now(), today: todayStr };
}

// Polled by the dashboard every ~2s. Also where background work happens
// (serverless has no timers): refreshing Asana every 20s, and quickly after a
// suspected stop.
async function live(ctx, query) {
  const tz = tzOf(query);
  const todayStr = ymdIn(Date.now(), tz);
  // one read for everything a poll needs
  const k = { state: K(ctx, 'state'), hb: K(ctx, 'hb'), day: K(ctx, `day:${todayStr}`), auto: K(ctx, 'autonow'), head: K(ctx, 'alertsHead'), chk: K(ctx, 'chk') };
  const g = await store.mget(Object.values(k));
  let s = { ...blank(), ...(g[k.state] || {}) };
  const cached = g[k.day];
  const age = cached ? Date.now() - cached.fetchedAt : Infinity;
  const hurry = s.suspect && Date.now() - s.suspect.stopAt < 30000 && age > 3000;
  let sig = cached?.sig || null;
  let changed = false;
  // Asana refresh: every 30s while someone looks, every 90s for background polls
  if ((age > (query.bg ? 90000 : 30000) || hurry) && store.throttle(`poll:${ctx.uid}`, 3000) && (await store.lock(K(ctx, 'poll'), 8000))) {
    try { sig = (await buildDay(ctx, todayStr, tz, true)).sig; changed = true; } catch {}
  }
  if (s.suspect) { await settleSuspect(ctx); changed = true; }
  if (changed) s = await getState(ctx);
  let running = runningToday(s.running, tz);
  if (running) {
    const c = g[k.chk]?.[running.taskGid];
    running = c && Date.now() - c.at < CHECK_TTL ? { ...running, check: { ok: c.ok, reasons: c.reasons } } : await withCheck(ctx, running);
  }
  const hb = g[k.hb];
  return {
    running, lastHeartbeat: hb?.at || 0, scriptV: hb?.diag?.v || null, serverNow: Date.now(), today: todayStr, sig,
    auto: g[k.auto] ? { ...g[k.auto], status: g[k.auto].status || 'pending', serverNow: Date.now() } : null,
    alertsHead: g[k.head] || null,
    _state: s, _hb: hb,
  };
}

async function clearRunning(ctx) {
  const s = await getState(ctx);
  if (s.running) s.ended.push(s.running.startedAt);
  s.running = null;
  await putState(ctx, s);
}

// "Remove lunch": takes the lunch minutes off one Asana entry. Tracket's only
// write to Asana, and only when the member clicks it.
async function removeLunch(ctx, entryGid, query) {
  const tz = tzOf(query);
  const todayStr = ymdIn(Date.now(), tz);
  const day = validDay(query.date, todayStr);
  const data = await buildDay(ctx, day, tz, true);
  const entry = data.tasks.flatMap((t) => t.entries).find((e) => e.gid === entryGid);
  const fail = (status, msg) => { const e = new Error(msg); e.status = status; return e; };
  if (!entry || !entry.lunchMin) throw fail(404, 'No lunch time left on that entry');
  const next = entry.minutes - entry.lunchMin;
  if (next < 1) throw fail(409, 'That whole entry was during lunch — delete it in Asana instead.');
  await asana(ctx, `/time_tracking_entries/${encodeURIComponent(entryGid)}`, { method: 'PUT', body: { data: { duration_minutes: next } } });
  const fixed = (await store.get(K(ctx, 'lunchfix'))) || {};
  fixed[entryGid] = { removed: entry.lunchMin, at: Date.now() };
  for (const [g, v] of Object.entries(fixed)) if (Date.now() - v.at > 45 * 24 * 3600e3) delete fixed[g];
  await store.set(K(ctx, 'lunchfix'), fixed, 45 * 24 * 3600);
  await buildDay(ctx, day, tz, true);
  return { ok: true, removed: entry.lunchMin, minutes: next };
}

module.exports = {
  today, live, onReport, clearRunning, verifyPat, removeLunch, settleSuspect, FRESH_MS,
  buildDay, checkTasks, commentsFor, getState, tzOf, ymdIn, dayStartMs, atTimeIn, me,
  _internal: { getState, ymdIn, dayStartMs, judge, lunchMinutes },
};
