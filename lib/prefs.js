// A member's preferences, at u:<id>:prefs:
//   tz      — their time zone (server-side checks run without a browser)
//   lunch   — { start, end } 'HH:MM' local, or null
//   auto    — { cap: { on, hours }, lunch: bool } auto mode (see lib/alerts.js)
//   report  — { on } end-of-day email report
const store = require('./store');

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULTS = { tz: null, lunch: null, auto: { cap: { on: false, hours: 7 }, lunch: false }, report: { on: false } };
const bad = (msg) => { const e = new Error(msg); e.status = 400; return e; };

async function get(uid) {
  const p = (await store.get(`u:${uid}:prefs`)) || {};
  return {
    tz: p.tz || null,
    lunch: p.lunch || null,
    auto: { cap: { ...DEFAULTS.auto.cap, ...(p.auto?.cap || {}) }, lunch: !!p.auto?.lunch },
    report: { ...DEFAULTS.report, ...(p.report || {}) },
  };
}

// Merges a partial update (only the parts sent) into the saved prefs.
async function update(uid, input = {}) {
  const cur = await get(uid);
  if (typeof input.tz === 'string') {
    try { new Intl.DateTimeFormat('en', { timeZone: input.tz }); cur.tz = input.tz; } catch {}
  }
  if ('lunch' in input) {
    const l = input.lunch;
    if (!l) cur.lunch = null;
    else {
      if (!HHMM.test(l.start || '') || !HHMM.test(l.end || '')) throw bad('Use HH:MM times for lunch');
      if (l.end <= l.start) throw bad('Lunch has to end after it starts');
      cur.lunch = { start: l.start, end: l.end };
    }
  }
  if (input.auto) {
    if (input.auto.cap) {
      const h = Number(input.auto.cap.hours ?? cur.auto.cap.hours);
      if (!(h >= 1 && h <= 16)) throw bad('Pick between 1 and 16 hours');
      cur.auto.cap = { on: !!(input.auto.cap.on ?? cur.auto.cap.on), hours: Math.round(h * 4) / 4 };
    }
    if ('lunch' in input.auto) cur.auto.lunch = !!input.auto.lunch;
  }
  if (cur.auto.lunch && !cur.lunch) throw bad('Set your lunch times to use the lunch auto stop');
  if (input.report) {
    const on = !!input.report.on;
    cur.report = { on, since: on ? (cur.report.on && cur.report.since) || Date.now() : null };
  }
  await store.set(`u:${uid}:prefs`, cur);
  return cur;
}

module.exports = { get, update, HHMM };
