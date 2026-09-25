// Tracket home-screen widget for Scriptable (free, iPhone/iPad): today's total
// and the running timer, both counting up live on your Home Screen.
// Install: Tracket → Settings → Phone widget. Tap the widget to open Tracket.
// ─────────────── filled in when you download it from Tracket ───────────────
const TRACKET_URL = 'http://localhost:3000';
const TRACKET_KEY = '';
// ─────────────────────────────────────────────────────────────────────────────
const C = { bg: '#0b0b10', card: '#16161f', ink: '#f3efe6', mute: '#8a879a', amber: '#ffb547', rec: '#ff4d6d', mint: '#5cf2b0' };
const pad = (n) => String(n).padStart(2, '0');
const hm = (min) => { const h = Math.floor(min / 60), m = Math.floor(min % 60); return h ? `${h}h ${pad(m)}m` : `${m}m`; };

async function load() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const r = new Request(`${TRACKET_URL.replace(/\/+$/, '')}/api/bar?tz=${encodeURIComponent(tz)}`);
  r.headers = { 'x-tracket-key': TRACKET_KEY };
  r.timeoutInterval = 10;
  return r.loadJSON();
}

function build(d, family) {
  const w = new ListWidget();
  w.backgroundColor = new Color(C.bg);
  w.setPadding(14, 14, 14, 14);
  w.url = d?.site || TRACKET_URL;
  const head = w.addText('TRACKET');
  head.font = Font.heavyMonospacedSystemFont(9); head.textColor = new Color(C.amber);
  w.addSpacer(6);
  if (!d || d.error) {
    const t = w.addText(d?.error === 'bad-key' ? 'Key changed — reinstall the widget' : 'Can’t reach Tracket');
    t.font = Font.mediumSystemFont(12); t.textColor = new Color(C.mute);
    return w;
  }
  const now = Date.now() + (d.serverNow ? d.serverNow - Date.now() : 0);
  const runMin = d.running ? Math.max(0, (now - d.running.startedAt) / 60000) : 0;
  const total = d.loggedMin + runMin;
  // total: counts up live while a timer runs
  if (d.running) {
    const t = w.addDate(new Date(Date.now() - total * 60000));
    t.applyTimerStyle(); t.font = Font.heavyMonospacedSystemFont(family === 'small' ? 26 : 32); t.textColor = new Color(C.ink);
  } else {
    const t = w.addText(hm(total)); t.font = Font.heavyMonospacedSystemFont(family === 'small' ? 26 : 32); t.textColor = new Color(C.ink);
  }
  const goal = w.addText(total >= 480 ? '8h done ✦' : total >= 420 ? '7h minimum done' : `${hm(420 - total)} to 7h`);
  goal.font = Font.mediumSystemFont(11); goal.textColor = new Color(total >= 420 ? C.mint : C.mute);
  w.addSpacer();
  if (d.running) {
    const row = w.addStack(); row.centerAlignContent();
    const dot = row.addText('● '); dot.font = Font.boldSystemFont(11); dot.textColor = new Color(C.rec);
    const since = row.addDate(new Date(d.running.startedAt)); since.applyTimerStyle(); since.font = Font.boldMonospacedSystemFont(11); since.textColor = new Color(C.rec);
    const name = w.addText(d.running.name || 'Untitled task');
    name.font = Font.mediumSystemFont(11); name.textColor = new Color(C.ink); name.lineLimit = family === 'small' ? 2 : 1;
  } else {
    const t = w.addText(d.linked ? 'Nothing ticking' : 'Asana tab not reporting');
    t.font = Font.mediumSystemFont(11); t.textColor = new Color(C.mute);
  }
  if (d.unread) { const a = w.addText(`🔔 ${d.unread} new`); a.font = Font.mediumSystemFont(10); a.textColor = new Color(C.amber); }
  w.refreshAfterDate = new Date(Date.now() + 5 * 60000);
  return w;
}

let data = null;
try { data = await load(); } catch (e) { data = null; }
const family = config.widgetFamily || 'small';
const widget = build(data, family);
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentSmall();
Script.complete();
