// Tracket core: talks to Asana, keeps the running-timer state, and exposes
// plain request handlers used by both Vercel functions (api/*) and the local
// server (server.js). Handlers take { query, body, headers } and return
// { status, body, headers? }.
const store = require('./store');

const API = 'https://app.asana.com/api/1.0';
const pat = () => (process.env.ASANA_PAT || '').trim();

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

// ---------- Asana ----------
async function asana(p) {
  const res = await fetch(API + p, { headers: { Authorization: `Bearer ${pat()}`, Accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.errors?.[0]?.message || `Asana ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function asanaAll(p) {
  const out = [];
  const sep = p.includes('?') ? '&' : '?';
  let url = `${p}${sep}limit=100`;
  for (let i = 0; i < 20 && url; i++) {
    const body = await asana(url);
    out.push(...(body.data || []));
    const off = body.next_page?.offset;
    url = off ? `${p}${sep}limit=100&offset=${off}` : null;
  }
  return out;
}

async function me() {
  let u = await store.get('me');
  if (!u) {
    u = (await asana('/users/me?opt_fields=gid,name,workspaces.name')).data;
    await store.set('me', u, 6 * 3600);
  }
  return u;
}

const ENTRY_FIELDS = 'duration_minutes,entered_on,created_at,created_by.gid,attributable_to.gid,task.gid,task.name,task.permalink_url';

// One call for all of a day's entries (newer Asana API).
const entriesDirect = (ws, user, day) => asanaAll(`/time_tracking_entries?workspace=${ws}&user=${user}` +
  `&entered_on_start_date=${day}&entered_on_end_date=${day}&opt_fields=${ENTRY_FIELDS}`);

// Fallback for workspaces without that endpoint: search tasks touched that day
// (plus tasks the userscript has seen), then read each task's entries.
async function entriesViaTasks(ws, user, day, tz) {
  const since = new Date(dayStartMs(day, tz)).toISOString();
  const candidates = new Map();
  for (const q of [`assignee.any=me&modified_at.after=${since}`, `followers.any=me&modified_at.after=${since}`]) {
    try {
      for (const t of await asanaAll(`/workspaces/${ws}/tasks/search?${q}&opt_fields=name,permalink_url&sort_by=modified_at`)) candidates.set(t.gid, t);
    } catch { /* search is a paid feature */ }
  }
  for (const [gid, t] of Object.entries((await store.get(`seen:${day}`)) || {}))
    if (!candidates.has(gid)) candidates.set(gid, { gid, name: t.name, permalink_url: t.url });

  const out = [];
  const list = [...candidates.values()];
  for (let i = 0; i < list.length; i += 8) {
    await Promise.all(list.slice(i, i + 8).map(async (t) => {
      try {
        for (const e of await asanaAll(`/tasks/${t.gid}/time_tracking_entries?opt_fields=${ENTRY_FIELDS}`)) {
          e.task = { gid: t.gid, name: e.task?.name || t.name, permalink_url: e.task?.permalink_url || t.permalink_url };
          out.push(e);
        }
      } catch {}
    }));
  }
  return out.filter((e) => e.entered_on === day && (e.created_by?.gid === user || e.attributable_to?.gid === user));
}

let directWorks = null;

async function fetchEntries(day, tz) {
  const user = await me();
  const entries = [];
  for (const ws of user.workspaces || []) {
    let got = null;
    if (directWorks !== false) {
      try { got = await entriesDirect(ws.gid, user.gid, day); directWorks = true; }
      catch (e) { if (e.status === 400 || e.status === 404) directWorks = false; else if (e.status === 402) got = []; else throw e; }
    }
    if (got === null) got = await entriesViaTasks(ws.gid, user.gid, day, tz);
    entries.push(...got);
  }
  return { user, entries };
}

// A day's summary, cached (today: 20s, past days: 5 min).
async function buildDay(day, tz, force) {
  const isNow = day === ymdIn(Date.now(), tz);
  const cached = await store.get(`day:${day}`);
  if (!force && cached && Date.now() - cached.fetchedAt < (isNow ? 20000 : 300000)) return cached;

  const { user, entries } = await fetchEntries(day, tz);
  if (isNow) await reconcileRunning(entries);

  const byTask = new Map();
  for (const e of entries) {
    const gid = e.task?.gid || 'unknown';
    const t = byTask.get(gid) || { gid, name: e.task?.name || 'Untitled task', url: e.task?.permalink_url || null, minutes: 0, entries: [] };
    t.minutes += e.duration_minutes || 0;
    t.entries.push({ minutes: e.duration_minutes || 0, createdAt: e.created_at });
    byTask.set(gid, t);
  }
  const tasks = [...byTask.values()].sort((a, b) => b.minutes - a.minutes);
  const payload = {
    date: day,
    user: { name: user.name },
    tasks,
    totalMinutes: tasks.reduce((s, t) => s + t.minutes, 0),
    sig: JSON.stringify(tasks.map((t) => [t.gid, t.minutes, t.entries.length, t.name])),
    fetchedAt: Date.now(),
  };
  await store.set(`day:${day}`, payload, isNow ? 3600 : 24 * 3600);
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
const getState = async () => ({ ...blank(), ...((await store.get('state')) || {}) });
const putState = (s) => { s.ended = (s.ended || []).slice(-100); return store.set('state', s); };

async function taskName(gid) {
  const names = (await store.get('names')) || {};
  if (names[gid]) return names[gid];
  try {
    const n = (await asana(`/tasks/${gid}?opt_fields=name`)).data.name;
    names[gid] = n;
    await store.set('names', names, 7 * 24 * 3600);
    return n;
  } catch { return null; }
}

async function rememberTask(day, gid, name, url) {
  const seen = (await store.get(`seen:${day}`)) || {};
  if (seen[gid]?.name === name) return;
  seen[gid] = { name, url };
  await store.set(`seen:${day}`, seen, 3 * 24 * 3600);
}

async function onReport({ running, previous, visible, diag, tz }) {
  const s = await getState();
  const cur = s.running;
  tz = tzOf({ tz });

  if (running?.taskGid && running.startedAt) {
    const start = Number(running.startedAt);
    const gid = String(running.taskGid);
    const known = (cur?.startedAt === start && cur.taskName) || (s.suspect?.startedAt === start && s.suspect.taskName);
    const r = { taskGid: gid, taskName: running.taskName || known || null, url: running.url || `https://app.asana.com/0/0/${gid}/f`, startedAt: start };
    if (!r.taskName && !gid.startsWith('name:')) r.taskName = await taskName(gid);

    let ended = s.ended.includes(start);
    if (s.suspect?.startedAt === start) {
      if (visible === false) { ended = true; s.suspect.seenAfter = Date.now(); }
      else s.suspect = null; // the tab you're looking at still shows it: false alarm
    }
    if (!ended && (!cur || start >= cur.startedAt)) {
      if (cur && cur.startedAt !== start) s.ended.push(cur.startedAt);
      s.running = r;
      if (!cur || cur.startedAt !== start) await rememberTask(ymdIn(start, tz), gid, r.taskName, r.url);
    }
  } else if (visible !== false && previous?.startedAt && cur && Number(previous.startedAt) === cur.startedAt) {
    s.suspect = { ...cur, stopAt: Date.now() };
    s.running = null;
  }
  await putState(s);
  await store.set('hb', { at: Date.now(), diag: diag || null }, 24 * 3600);
}

// If Asana logged an entry for the running (or suspected-stopped) timer after
// it started, that timer is over — also covers stopping from another device.
async function reconcileRunning(entries) {
  const s = await getState();
  const loggedAfter = (t) => entries.some((e) =>
    (String(e.task?.gid) === t.taskGid || (t.taskGid.startsWith('name:') && e.task?.name?.trim() === t.taskName)) &&
    Date.parse(e.created_at) > t.startedAt + 5000);
  let dirty = false;
  if (s.suspect && loggedAfter(s.suspect)) { s.ended.push(s.suspect.startedAt); s.suspect = null; dirty = true; }
  if (s.running && loggedAfter(s.running)) { s.ended.push(s.running.startedAt); s.running = null; dirty = true; }
  if (dirty) await putState(s);
}

// A suspected stop that Asana never confirmed within 25s: for a long timer
// that tabs still show, it was a false alarm → restore. Otherwise it's over.
async function settleSuspect() {
  const s = await getState();
  const sp = s.suspect;
  if (!sp || Date.now() - sp.stopAt < 25000) return;
  if (!s.running && sp.stopAt - sp.startedAt > 120000 && sp.seenAfter > sp.stopAt) {
    const { stopAt, seenAfter, ...back } = sp;
    s.running = back;
  } else s.ended.push(sp.startedAt);
  s.suspect = null;
  await putState(s);
}

const runningToday = (r, tz) => (r && ymdIn(r.startedAt, tz) === ymdIn(Date.now(), tz) ? r : null);

// ---------- handlers ----------
const need = () => (pat() ? null : { status: 500, body: { error: 'ASANA_PAT is not set' } });
const validDay = (d, todayStr) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') && d <= todayStr ? d : todayStr);

async function handleToday({ query }) {
  const miss = need(); if (miss) return miss;
  const tz = tzOf(query);
  const todayStr = ymdIn(Date.now(), tz);
  const day = validDay(query.date, todayStr);
  const data = await buildDay(day, tz, 'force' in query);
  const s = await getState();
  const hb = await store.get('hb');
  return { status: 200, body: { ...data, running: day === todayStr ? runningToday(s.running, tz) : null, lastHeartbeat: hb?.at || 0, serverNow: Date.now(), today: todayStr } };
}

// Polled by the dashboard every ~2s. Also the place where background work
// happens (serverless has no timers): refreshing Asana every 20s, and quickly
// after a suspected stop.
async function handleLive({ query }) {
  const miss = need(); if (miss) return miss;
  const tz = tzOf(query);
  const todayStr = ymdIn(Date.now(), tz);
  let s = await getState();
  const cached = await store.get(`day:${todayStr}`);
  const age = cached ? Date.now() - cached.fetchedAt : Infinity;
  const hurry = s.suspect && Date.now() - s.suspect.stopAt < 30000 && age > 3000;
  let sig = cached?.sig || null;
  if ((age > 20000 || hurry) && (await store.lock('poll', 8000))) {
    try { sig = (await buildDay(todayStr, tz, true)).sig; } catch {}
  }
  if (s.suspect) { await settleSuspect(); }
  s = await getState();
  const hb = await store.get('hb');
  return { status: 200, body: { running: runningToday(s.running, tz), lastHeartbeat: hb?.at || 0, serverNow: Date.now(), today: todayStr, sig } };
}

async function handleEvent({ body }) {
  await onReport(body || {});
  return { status: 200, body: { ok: true } };
}

async function handleClearRunning() {
  const s = await getState();
  if (s.running) s.ended.push(s.running.startedAt);
  s.running = null;
  await putState(s);
  return { status: 200, body: { ok: true } };
}

module.exports = { handleToday, handleLive, handleEvent, handleClearRunning, _internal: { onReport, getState, ymdIn, dayStartMs } };
