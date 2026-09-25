// End-of-day email report: the day's total, tickets, anything worth a second
// look, and every reminder sent that day. Sent 30 min after the shift ends (or
// at 20:00 without a shift that day), by whichever trigger runs first after
// that. A day missed because nothing ran is sent late, the next day.
const store = require('./store');
const core = require('./core');
const { sendEmail, esc } = require('./notify');

const K = (uid, n) => `u:${uid}:${n}`;
const MIN_SEC = 7 * 3600, GOAL_SEC = 8 * 3600;
const PAST = {
  low: 'Oh no! Under the 7h minimum — that’s a day that gets the email.',
  ok: 'Bare minimum logged — 7h, you made it.',
  over: 'Over 8h — that was a big one.',
};

const prevDay = (day) => new Date(Date.parse(`${day}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);

async function build(ctx, day, tz, siteUrl) {
  const alerts = require('./alerts');
  const { hm } = alerts;
  const data = await core.buildDay(ctx, day, tz, false);
  const shift = alerts.shiftFor(await store.get(K(ctx.uid, 'shift')), day, tz);
  const items = (await alerts.feed(ctx.uid)).items.filter((a) => a.day === day && a.kind !== 'autoOffer');
  const autos = await alerts.autoLog(ctx.uid, day);
  const total = data.totalMinutes * 60;
  const level = total >= GOAL_SEC ? 'over' : total >= MIN_SEC ? 'ok' : 'low';
  const score = Math.round((total / MIN_SEC) * 100);

  const concerns = [];
  if (level === 'low') concerns.push(`Under the 7h minimum — ${hm(MIN_SEC - total)} short.`);
  for (const t of data.tasks) {
    if (t.check && !t.check.ok) concerns.push(`⚠ ${t.name}: ${t.check.reasons.join(' · ')}`);
    if (t.comment === false) concerns.push(`💬 ${t.name}: no comment from you that day.`);
    if (t.lunchMin > 0) concerns.push(`🍽 ${t.name}: ${hm(t.lunchMin * 60)} logged during lunch.`);
  }
  for (const a of autos) if (a.status !== 'done') concerns.push(`Auto mode: “${a.title}” was ${a.status}.`);

  const when = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const color = { low: '#e0314f', ok: '#c77a00', over: '#16a34a' }[level];
  const time = (id) => new Date(id).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  const row = (a, b) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${a}</td><td style="padding:6px 0 6px 12px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;font-family:ui-monospace,Menlo,monospace">${b}</td></tr>`;
  const site = siteUrl || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');

  const html = `<div style="font-family:-apple-system,system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px">
    <p style="margin:0;color:#888;font-size:12px;letter-spacing:.12em;text-transform:uppercase">Tracket · daily report</p>
    <h2 style="margin:4px 0 2px">${esc(when)}</h2>
    <p style="margin:0;font-size:34px;font-weight:800;font-family:ui-monospace,Menlo,monospace">${hm(total)}</p>
    <p style="margin:4px 0 0;color:${color};font-weight:600">${esc(PAST[level])}</p>
    <p style="margin:4px 0 16px;color:#666">${shift ? `Shift ${shift.start}–${shift.end} · ` : ''}score ${score} (100 = the 7h minimum)</p>
    ${concerns.length ? `<h3 style="margin:18px 0 6px">Worth a look</h3><ul style="margin:0;padding-left:18px">${concerns.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : '<p style="color:#16a34a">Nothing to flag. Clean day ✦</p>'}
    <h3 style="margin:18px 0 6px">Tickets</h3>
    ${data.tasks.length ? `<table style="width:100%;border-collapse:collapse">${data.tasks.map((t) => row(t.url ? `<a href="${esc(t.url)}" style="color:#111">${esc(t.name)}</a>` : esc(t.name), hm(t.minutes * 60))).join('')}</table>` : '<p style="color:#666">No time logged.</p>'}
    ${autos.length ? `<h3 style="margin:18px 0 6px">Auto mode</h3><table style="width:100%;border-collapse:collapse">${autos.map((a) => row(esc(a.title), a.status)).join('')}</table>` : ''}
    ${items.length ? `<h3 style="margin:18px 0 6px">Reminders sent</h3><table style="width:100%;border-collapse:collapse">${items.map((a) => row(`${esc(a.title)}${a.body ? `<br><span style="color:#777;font-size:13px">${esc(a.body)}</span>` : ''}`, time(a.id))).join('')}</table>` : ''}
    ${site ? `<p style="margin-top:22px"><a href="${esc(site)}/?date=${day}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#ffb547;color:#111;text-decoration:none;font-weight:700">Open in Tracket</a></p>` : ''}
    <p style="color:#aaa;font-size:12px;margin-top:18px">Turn this email off in Tracket → Settings → Daily email report.</p></div>`;
  const text = [`Tracket · ${when}`, `${hm(total)} logged — ${PAST[level]}`, '', ...(concerns.length ? ['Worth a look:', ...concerns.map((c) => `- ${c}`), ''] : []),
    'Tickets:', ...data.tasks.map((t) => `- ${t.name}: ${hm(t.minutes * 60)}`)].join('\n');
  const subject = `Tracket · ${when}: ${hm(total)}${concerns.length ? ` · ${concerns.length} to check` : ' ✦'}`;
  return { subject, html, text, total, hasShift: !!shift };
}

async function sendFor(ctx, day, tz, { siteUrl, skipEmpty } = {}) {
  const m = ((await store.get('members')) || {})[ctx.uid];
  if (!m?.email) return { ok: false, error: 'No email on your account' };
  const r = await build(ctx, day, tz, siteUrl);
  if (skipEmpty && !r.total && !r.hasShift) return { ok: true, skipped: true };
  const res = await sendEmail({ to: m.email, subject: r.subject, html: r.html, text: r.text });
  await store.set(K(ctx.uid, 'reportlast'), { at: Date.now(), day, to: m.email, ...res }, 30 * 24 * 3600);
  return res;
}

// Called from alerts.evaluate when the member has reports on.
async function maybeSend(ctx, { p, tz, now, day, shift }) {
  const rtKey = K(ctx.uid, `rt:${day}`);
  const rt = (await store.get(rtKey)) || { sent: {}, peak: 0, lastRun: null };
  let dirty = false;
  const sendAt = shift ? shift.to + 30 * 60e3 : core.atTimeIn(day, '20:00', tz);
  if (!rt.report && now >= sendAt && (await store.lock(K(ctx.uid, `report:${day}`), 10 * 60e3))) {
    rt.report = await sendFor(ctx, day, tz, { skipEmpty: true });
    dirty = true;
  }
  // yesterday's, if nothing ran after it was due (and reports were on by then)
  if (!rt.checkedY) {
    rt.checkedY = true; dirty = true;
    const y = prevDay(day);
    const yKey = K(ctx.uid, `rt:${y}`);
    const ry = await store.get(yKey);
    const ySendAt = core.atTimeIn(y, '20:00', tz);
    if (!ry?.report && (p.report.since || 0) < ySendAt && (await store.lock(K(ctx.uid, `report:${y}`), 10 * 60e3))) {
      const res = await sendFor(ctx, y, tz, { skipEmpty: true });
      await store.set(yKey, { ...(ry || { sent: {} }), report: res }, 3 * 24 * 3600);
    }
  }
  if (dirty) await store.set(rtKey, { ...((await store.get(rtKey)) || rt), report: rt.report, checkedY: rt.checkedY }, 3 * 24 * 3600);
}

// ---------- weekly report: the last 7 days ----------
// Sent on the last working day of the week (the last day of your shift
// pattern, Friday without one), 30 min after that shift ends (20:00 without).
const DAY_MS = 864e5;
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const weekday = (day) => new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = Sunday

async function buildWeekly(ctx, to, tz, siteUrl) {
  const { hm } = require('./alerts');
  const from = addDays(to, -6);
  const r = await core.rangeTotals(ctx, from, to, tz);
  const days = [...Array(7)].map((_, i) => addDays(from, i)).map((d) => ({ d, min: r.byDay[d] || 0 }));
  const worked = days.filter((x) => x.min > 0);
  const total = days.reduce((a, x) => a + x.min, 0);
  const full = worked.filter((x) => x.min >= 7 * 60).length;
  const avg = worked.length ? total / worked.length : 0;
  const label = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const bar = (m) => { const w = Math.round(Math.min(1, m / 540) * 100); const c = m >= 480 ? '#16a34a' : m >= 420 ? '#c77a00' : '#e0314f';
    return `<div style="height:10px;border-radius:5px;background:#eee;overflow:hidden"><div style="height:10px;width:${w}%;background:${c}"></div></div>`; };
  const site = siteUrl || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  const range = `${label(from)} – ${label(to)}`;
  const html = `<div style="font-family:-apple-system,system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px">
    <p style="margin:0;color:#888;font-size:12px;letter-spacing:.12em;text-transform:uppercase">Tracket · weekly report</p>
    <h2 style="margin:4px 0 2px">${esc(range)}</h2>
    <p style="margin:0;font-size:34px;font-weight:800;font-family:ui-monospace,Menlo,monospace">${hm(total * 60)}</p>
    <p style="margin:4px 0 16px;color:#666">${full} of ${worked.length} working day${worked.length === 1 ? '' : 's'} at 7h or more · ${hm(avg * 60)} a day on average</p>
    <table style="width:100%;border-collapse:collapse">${days.map((x) => `<tr><td style="padding:5px 0;width:110px;color:#555">${esc(label(x.d))}</td><td style="padding:5px 10px">${bar(x.min)}</td><td style="padding:5px 0;text-align:right;white-space:nowrap;font-family:ui-monospace,Menlo,monospace">${x.min ? hm(x.min * 60) : '—'}</td></tr>`).join('')}</table>
    <h3 style="margin:20px 0 6px">Top tickets</h3>
    ${r.tasks.length ? `<table style="width:100%;border-collapse:collapse">${r.tasks.slice(0, 8).map((t) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${t.url ? `<a href="${esc(t.url)}" style="color:#111">${esc(t.name)}</a>` : esc(t.name)}</td><td style="padding:6px 0 6px 12px;border-bottom:1px solid #eee;text-align:right;font-family:ui-monospace,Menlo,monospace">${hm(t.minutes * 60)}</td></tr>`).join('')}</table>` : '<p style="color:#666">No time logged.</p>'}
    ${site ? `<p style="margin-top:22px"><a href="${esc(site)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#ffb547;color:#111;text-decoration:none;font-weight:700">Open Tracket</a></p>` : ''}
    <p style="color:#aaa;font-size:12px;margin-top:18px">Turn this email off in Tracket → Settings → Notifications.</p></div>`;
  const text = [`Tracket · week ${range}`, `${hm(total * 60)} · ${full}/${worked.length} days at 7h+`, '', ...days.map((x) => `${label(x.d)}: ${x.min ? hm(x.min * 60) : '—'}`), '', 'Top tickets:', ...r.tasks.slice(0, 8).map((t) => `- ${t.name}: ${hm(t.minutes * 60)}`)].join('\n');
  return { subject: `Tracket · your week: ${hm(total * 60)} · ${full}/${worked.length} full days`, html, text };
}

async function sendWeekly(ctx, day, tz, { siteUrl } = {}) {
  const m = ((await store.get('members')) || {})[ctx.uid];
  if (!m?.email) return { ok: false, error: 'No email on your account' };
  const r = await buildWeekly(ctx, day, tz, siteUrl);
  const res = await sendEmail({ to: m.email, subject: r.subject, html: r.html, text: r.text });
  await store.set(K(ctx.uid, 'weeklast'), { at: Date.now(), day, to: m.email, ...res }, 30 * 24 * 3600);
  return res;
}

async function maybeSendWeekly(ctx, { tz, now, day, shift }) {
  const pattern = (await store.get(K(ctx.uid, 'shift'), { cache: 60000 }))?.days || {};
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => pattern[d]);
  const lastDay = order.length ? order[order.length - 1] : 5;
  if (weekday(day) !== lastDay) return;
  const sendAt = shift ? shift.to + 30 * 60e3 : core.atTimeIn(day, '20:00', tz);
  if (now < sendAt) return;
  if (await store.get(K(ctx.uid, `wk:${day}`))) return;
  if (!(await store.lock(K(ctx.uid, `wklock:${day}`), 10 * 60e3))) return;
  const res = await sendWeekly(ctx, day, tz);
  await store.set(K(ctx.uid, `wk:${day}`), { at: now, ok: res.ok }, 14 * 24 * 3600);
}

module.exports = { maybeSend, sendFor, build, maybeSendWeekly, sendWeekly, buildWeekly };
