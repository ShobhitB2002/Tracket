// Leave and holidays, per member: u:<id>:leave = { days: { 'YYYY-MM-DD': label } }.
// On a leave day there's no shift: no shift reminders, no nudges, no Failsafe,
// no daily report (unless you logged time), and streaks and weekly/monthly
// stats skip the day.
const store = require('./store');

const K = (uid) => `u:${uid}:leave`;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const bad = (msg) => { const e = new Error(msg); e.status = 400; return e; };
const next = (d) => new Date(Date.parse(`${d}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);

async function get(uid) { return (await store.get(K(uid), { cache: 60000 })) || { days: {} }; }
async function on(uid, day) { return (await get(uid)).days[day] ?? null; }

async function update(uid, { add, remove } = {}) {
  const cur = await get(uid);
  if (add) {
    const from = add.from, to = add.to || add.from;
    if (!DAY.test(from || '') || !DAY.test(to || '') || to < from) throw bad('Pick a start and end date');
    const label = String(add.label || 'Leave').trim().slice(0, 40) || 'Leave';
    let n = 0;
    for (let d = from; d <= to && n < 60; d = next(d), n++) cur.days[d] = label;
  }
  if (remove) for (const d of [].concat(remove)) delete cur.days[d];
  // keep a year back and ahead
  const cut = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
  for (const d of Object.keys(cur.days)) if (d < cut) delete cur.days[d];
  await store.set(K(uid), cur);
  return cur;
}

module.exports = { get, on, update };
