// A member's preferences, at u:<id>:prefs:
//   tz      — their time zone (server-side checks run without a browser)
//   lunch   — { start, end } 'HH:MM' local, or null
//   auto    — { cap: { on, hours }, lunch: bool, failsafe: bool } auto mode (see lib/alerts.js); hours to the minute, e.g. 7.5.
//             failsafe = never let a timer run outside the shift (or past the daily limit), with no Deny
//   report  — { on, weekly } end-of-day and end-of-week email reports
//   nudge   — { idle, late } reminders: no timer running during the shift / timer left running after it
//   team    — { share } show me on the admin's team board (totals and status only)
//   theme   — dashboard theme (see public/themes.js), 'default' if unset
const store = require('./store');

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULTS = { tz: null, lunch: null, auto: { cap: { on: false, hours: 7 }, lunch: false, failsafe: false }, report: { on: false, weekly: false },
  nudge: { idle: true, late: true }, team: { share: false }, theme: 'default' };
const THEMES = ['default', 'system', 'dark', 'light', 'anime', 'manhwa', 'movies', 'coding', 'games', 'guardian', 'alienwatch',
  'cyberpunk', 'synthwave', 'space', 'ocean', 'forest', 'notebook', 'rpg', 'cricket', 'festive', 'eink', 'halloween'];
const bad = (msg) => { const e = new Error(msg); e.status = 400; return e; };

async function get(uid) {
  const p = (await store.get(`u:${uid}:prefs`, { cache: 30000 })) || {};
  return {
    tz: p.tz || null,
    lunch: p.lunch || null,
    auto: { cap: { ...DEFAULTS.auto.cap, ...(p.auto?.cap || {}) }, lunch: !!p.auto?.lunch, failsafe: !!p.auto?.failsafe },
    report: { ...DEFAULTS.report, ...(p.report || {}) },
    nudge: { ...DEFAULTS.nudge, ...(p.nudge || {}) },
    team: { ...DEFAULTS.team, ...(p.team || {}) },
    theme: THEMES.includes(p.theme) ? p.theme : DEFAULTS.theme,
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
      if (!(h >= 1 && h <= 16)) throw bad('Pick between 1h and 16h');
      cur.auto.cap = { on: !!(input.auto.cap.on ?? cur.auto.cap.on), hours: Math.round(h * 60) / 60 }; // to the minute
    }
    if ('lunch' in input.auto) cur.auto.lunch = !!input.auto.lunch;
    if ('failsafe' in input.auto) cur.auto.failsafe = !!input.auto.failsafe;
  }
  if (cur.auto.lunch && !cur.lunch) throw bad('Set your lunch times to use the lunch auto stop');
  if (typeof input.theme === 'string') {
    if (!THEMES.includes(input.theme)) throw bad('Unknown theme');
    cur.theme = input.theme;
  }
  if (input.report) {
    if ('on' in input.report) { const on = !!input.report.on; cur.report = { ...cur.report, on, since: on ? (cur.report.on && cur.report.since) || Date.now() : null }; }
    if ('weekly' in input.report) cur.report.weekly = !!input.report.weekly;
  }
  if (input.nudge) for (const k of ['idle', 'late']) if (k in input.nudge) cur.nudge[k] = !!input.nudge[k];
  if (input.team && 'share' in input.team) cur.team.share = !!input.team.share;
  await store.set(`u:${uid}:prefs`, cur);
  return cur;
}

module.exports = { get, update, HHMM };
