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

module.exports = { maybeSend, sendFor, build };
