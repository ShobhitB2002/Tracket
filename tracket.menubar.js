#!/usr/bin/osascript -l JavaScript
// <swiftbar.type>streamable</swiftbar.type>
// <swiftbar.title>Tracket</swiftbar.title>
// <swiftbar.version>2.0</swiftbar.version>
// <swiftbar.author>Tracket</swiftbar.author>
// <swiftbar.desc>Your running Asana timer (to the second), today's total and Tracket alerts in the menu bar.</swiftbar.desc>
// <swiftbar.hideAbout>true</swiftbar.hideAbout>
// <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
// <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>
//
// Tracket menu bar plugin for SwiftBar (https://swiftbar.app), "streamable":
// SwiftBar starts it once and it redraws every second by itself. It asks
// Tracket for new data once a minute (free-tier friendly) and counts the
// running timer locally in between, so the seconds tick smoothly.

// ─────────────── filled in when you download it from Tracket ───────────────
const TRACKET_URL = 'http://localhost:3000';
const TRACKET_KEY = '';
// ─────────────────────────────────────────────────────────────────────────────
const FETCH_EVERY = 60000;

ObjC.import('Foundation');

function run(argv) {
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  const env = (k) => { const v = $.NSProcessInfo.processInfo.environment.objectForKey(k); return v ? v.js : ''; };
  const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  const base = TRACKET_URL.replace(/\/+$/, '');
  const cache = (env('TMPDIR') || '/tmp/') + 'tracket-bar.json';
  const readFile = (p) => { const s = $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null); return s.isNil() ? null : s.js; };
  const writeFile = (p, s) => $(s).writeToFileAtomicallyEncodingError(p, true, $.NSUTF8StringEncoding, null);
  const curl = (method, path, body) => app.doShellScript(`/usr/bin/curl -s -m 8 -w '\\n%{http_code}' -X ${method} -H ${q('x-tracket-key: ' + TRACKET_KEY)}` +
    (body ? ` -H 'Content-Type: application/json' -d ${q(JSON.stringify(body))}` : '') + ` ${q(base + path)}`, { alteringLineEndings: false });
  const self = env('SWIFTBAR_PLUGIN_PATH');

  // Menu actions run this same file with an argument; emptying the cache file
  // tells the running copy to fetch again right away.
  if (argv[0] === 'seen') { try { curl('POST', '/api/alerts/seen', { upTo: 9e15 }); } catch (e) {} writeFile(cache, ''); return ''; }
  if (argv[0] === 'refresh') { writeFile(cache, ''); return ''; }

  let c = null, problem = null;
  try { c = JSON.parse(readFile(cache) || 'null'); } catch (e) {}
  function fetchNow() {
    try {
      const tz = $.NSTimeZone.localTimeZone.name.js;
      const out = curl('GET', '/api/bar?tz=' + encodeURIComponent(tz)).split('\n');
      const code = out.pop();
      if (code === '200') { c = JSON.parse(out.join('\n')); c.fetchedLocal = Date.now(); writeFile(cache, JSON.stringify(c)); problem = null; }
      else problem = code === '401' ? 'Key no longer valid — install the plugin again from Tracket → Settings.' : `Tracket answered ${code}`;
    } catch (e) { problem = 'Can’t reach Tracket — offline?'; }
    if (!c) writeFile(cache, 'null');
  }

  const clean = (s) => String(s || '').replace(/\|/g, '¦').replace(/\n/g, ' ');
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60); return h ? `${h}h ${pad(m)}m` : `${m}m`; };
  const hms = (sec) => { sec = Math.max(0, Math.floor(sec)); return `${Math.floor(sec / 3600)}:${pad(Math.floor(sec % 3600 / 60))}:${pad(sec % 60)}`; };
  const act = (arg) => (self ? `bash=${JSON.stringify(self)} param1=${arg} terminal=false` : '');

  function render() {
    const L = [];
    if (!c) {
      L.push('◔ ⚠', '---', clean(problem || 'Loading…') + ' | color=#ff9f0a', `Open Tracket | href=${base}`, `Try again | ${act('refresh')}`);
      return L.join('\n');
    }
    const now = Date.now() + (c.serverNow - c.fetchedLocal);
    const runSec = c.running ? Math.max(0, (now - c.running.startedAt) / 1000) : 0;
    const total = c.loggedMin * 60 + runSec;
    const bell = c.unread ? `🔔${c.unread} ` : '';
    // monospaced digits so the title doesn't wobble as seconds change
    L.push(c.running ? `${bell}● ${hms(runSec)} · ${hms(total)} | font=Menlo size=12` : `${bell}◔ ${hm(total)}`);
    L.push('---');
    if (c.running) L.push(`● ${clean(c.running.name || 'Untitled task')} | href=${c.running.url} length=60 color=#ff4d6d`, `Running for ${hms(runSec)} | size=12 font=Menlo`);
    else L.push('Nothing ticking | color=gray');
    const status = total >= 8 * 3600 ? '8h goal done ✦' : total >= 7 * 3600 ? '7h minimum done' : `${hm(7 * 3600 - total)} to 7h`;
    L.push(`Today ${hms(total)} · ${status} | size=12`);
    if (!c.linked) L.push('Asana tab isn’t reporting — live timer paused | color=#ff9f0a size=12');
    if (problem) L.push(clean(problem) + ' | color=#ff9f0a size=12');
    if (c.tasks.length) {
      L.push('---', 'Tickets | size=11 color=gray');
      for (const t of c.tasks) L.push(`${hm(t.min * 60)}   ${clean(t.name)}${t.warn ? ' ⚠' : ''}${t.noComment ? ' 💬' : ''}${t.lunchMin ? ' 🍽' : ''} | ${t.url ? `href=${t.url} ` : ''}length=60`);
    }
    L.push('---', `Alerts${c.unread ? ` (${c.unread} new)` : ''} | size=11 color=gray`);
    if (!c.alerts.length) L.push('Nothing yet | color=gray');
    for (const a of c.alerts) L.push(`${a.unread ? '● ' : '   '}${clean(a.title)} | length=70 tooltip=${JSON.stringify(clean(a.body))}`);
    if (c.unread && self) L.push(`Mark all read | ${act('seen')}`);
    L.push('---', `Updated ${Math.round((Date.now() - c.fetchedLocal) / 1000)}s ago · Refresh now | ${act('refresh')} size=11`, `Open Tracket | href=${c.site || base}`);
    return L.join('\n');
  }

  // Run once from Terminal (for testing); stream forever under SwiftBar.
  if (!env('SWIFTBAR')) { if (!c || Date.now() - c.fetchedLocal > FETCH_EVERY) fetchNow(); return render(); }
  const out = $.NSFileHandle.fileHandleWithStandardOutput;
  const emit = (s) => out.writeData($('~~~\n' + s + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
  let lastFetch = c ? c.fetchedLocal : 0;
  for (;;) {
    const forced = readFile(cache) === '';
    if (forced || Date.now() - lastFetch > FETCH_EVERY) { fetchNow(); lastFetch = Date.now(); }
    emit(render());
    delay(1);
  }
}
