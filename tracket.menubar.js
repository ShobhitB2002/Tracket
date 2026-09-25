#!/usr/bin/osascript -l JavaScript
// <swiftbar.type>streamable</swiftbar.type>
// <swiftbar.title>Tracket</swiftbar.title>
// <swiftbar.version>2.3</swiftbar.version>
// <swiftbar.author>Tracket</swiftbar.author>
// <swiftbar.desc>Your running Asana timer (to the second), today's total and Tracket alerts in the menu bar.</swiftbar.desc>
// <swiftbar.hideAbout>true</swiftbar.hideAbout>
// <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
// <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>
//
// Tracket menu bar plugin for SwiftBar (https://swiftbar.app), "streamable":
// SwiftBar starts it once and it redraws every second by itself, counting the
// running timer locally so the seconds tick smoothly.
// Real-time without extra server calls: every 2s it peeks at your open Asana
// tabs (Safari, Chrome, Brave, Edge) through Apple Events, and the moment a
// timer starts or stops there it fetches from Tracket. Otherwise it fetches
// once a minute — or every 30s if it can't see the tabs (then turn on
// "Allow JavaScript from Apple Events" in the browser's Develop menu).
// Auto mode backup: Safari freezes background tabs, so if no Asana tab has
// acted a few seconds after an auto-mode countdown ends, this plugin presses
// Asana's Stop/Start button itself through Apple Events (opening the ticket in
// that tab, or in a new Safari tab, when the button isn't on screen).

// ─────────────── filled in when you download it from Tracket ───────────────
const TRACKET_URL = 'http://localhost:3000';
const TRACKET_KEY = '';
// ─────────────────────────────────────────────────────────────────────────────
const FETCH_EVERY = 60000;      // when it can watch your Asana tabs
const FETCH_BLIND = 30000;      // when it can't
const WATCH_EVERY = 2000;
const FETCH_NEAR = 10000;       // within 3 min of your daily limit
const FETCH_AUTO = 3000;        // while an auto-mode action is pending
const TABS_FIRST = 6000;        // Asana tabs get this long after the countdown before we step in
const CHROMIUMS = ['Google Chrome', 'Brave Browser', 'Microsoft Edge'];

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
  if (argv[0] === 'start' || argv[0] === 'stop') {
    let msg = '';
    try { const out = curl('POST', '/api/control', { action: argv[0] }).split('\n'); const code = out.pop(); if (code !== '200') msg = (JSON.parse(out.join('\n')).error || code); } catch (e) { msg = 'Can’t reach Tracket'; }
    if (msg) app.displayNotification(msg, { withTitle: 'Tracket' });
    writeFile(cache, ''); return '';
  }
  if (argv[0] === 'deny') { try { curl('POST', '/api/auto', { id: argv[1], op: 'deny' }); } catch (e) {} writeFile(cache, ''); return ''; }

  let c = null, problem = null;
  try { c = JSON.parse(readFile(cache) || 'null'); } catch (e) {}
  function fetchNow() {
    try {
      const tz = $.NSTimeZone.localTimeZone.name.js;
      // act=1: we can drive the Asana tabs, so Tracket may run auto mode for us
      const out = curl('GET', '/api/bar?tz=' + encodeURIComponent(tz) + (watching ? '&act=1' : '')).split('\n');
      const code = out.pop();
      if (code === '200') { c = JSON.parse(out.join('\n')); c.fetchedLocal = Date.now(); writeFile(cache, JSON.stringify(c)); problem = null; }
      else problem = code === '401' ? 'Key no longer valid — install the plugin again from Tracket → Settings.' : `Tracket answered ${code}`;
    } catch (e) { problem = 'Can’t reach Tracket — offline?'; }
    if (!c) writeFile(cache, 'null');
  }

  // Timer state of every open Asana tab, as a string that changes when a timer
  // starts or stops; null when no browser lets us look.
  const READ = "document.documentElement.getAttribute('data-tracket-timer')";
  let blindWhy = null;
  function asanaTabs() {
    const seen = [];
    let looked = false;
    const isAsana = (u) => typeof u === 'string' && u.startsWith('https://app.asana.com/');
    try {
      const s = Application('Safari');
      if (s.running()) {
        s.windows.tabs.url().forEach((tabs, wi) => tabs.forEach((u, ti) => {
          if (!isAsana(u)) return;
          try { seen.push(s.doJavaScript(READ, { in: s.windows[wi].tabs[ti] }) || '-'); looked = true; }
          catch (e) { blindWhy = 'Safari → Develop → Allow JavaScript from Apple Events'; }
        }));
      }
    } catch (e) { blindWhy = blindWhy || 'allow SwiftBar to control your browser (System Settings → Privacy & Security → Automation)'; }
    for (const name of CHROMIUMS) {
      try {
        const b = Application(name);
        if (!b.running()) continue;
        b.windows.tabs.url().forEach((tabs, wi) => tabs.forEach((u, ti) => {
          if (!isAsana(u)) return;
          try { seen.push(b.windows[wi].tabs[ti].execute({ javascript: READ }) || '-'); looked = true; }
          catch (e) { blindWhy = `${name} → View → Developer → Allow JavaScript from Apple Events`; }
        }));
      } catch (e) {}
    }
    if (looked) blindWhy = null;
    // only state + start matter (names load late)
    return looked ? seen.map((x) => { try { const t = JSON.parse(x); return `${t.state}:${t.startedAt || ''}`; } catch (e) { return x; } }).join('|') : null;
  }

  // ---- auto mode backup ----
  // One step of pressing Asana's button, run inside the tab; called every
  // second until it answers 'done'. State lives on window.__tkAct.
  const STEP = (id, action, gid) => `(() => {
    const q = (s) => document.querySelector(s);
    const stop = q('[aria-label="Stop timer"], .ActiveTimerStopButton, .ActiveTimerStopButton-label');
    const start = q('[aria-label="Start timer"]');
    const press = (el) => (el.closest('[role=button],button') || el).click();
    let st = window.__tkAct;
    if (!st || st.id !== ${JSON.stringify(id)}) st = window.__tkAct = { id: ${JSON.stringify(id)} };
    const onTicket = location.href.includes(${JSON.stringify(gid || '-')});
    const open = () => { history.pushState(null, '', '/0/0/' + ${JSON.stringify(gid || '')} + '/f'); dispatchEvent(new PopStateEvent('popstate')); st.opened = Date.now(); return 'opening'; };
    if (${JSON.stringify(action)} === 'stop') {
      if (st.pressed && !stop) return 'done';
      if (stop) { if (!st.pressed || Date.now() - st.pressed > 4000) { press(stop); st.pressed = Date.now(); } return 'pressed'; }
      return st.opened || !${JSON.stringify(gid || '')} ? 'waiting' : open();
    }
    if (st.pressed && stop && onTicket) return 'done';
    if (start && onTicket) { if (!st.pressed || Date.now() - st.pressed > 4000) { press(start); st.pressed = Date.now(); } return 'pressed'; }
    return st.opened ? 'waiting' : open();
  })()`;
  const HAS_STOP = "!!document.querySelector('[aria-label=\"Stop timer\"], .ActiveTimerStopButton, .ActiveTimerStopButton-label')";

  // Every open Asana tab, as something we can run JavaScript in.
  function tabRefs() {
    const refs = [];
    const isAsana = (u) => typeof u === 'string' && u.startsWith('https://app.asana.com/') && !u.startsWith('https://app.asana.com/-/');
    try {
      const s = Application('Safari');
      if (s.running()) s.windows.tabs.url().forEach((tabs, wi) => tabs.forEach((u, ti) => {
        if (isAsana(u)) refs.push({ run: (js) => s.doJavaScript(js, { in: s.windows[wi].tabs[ti] }) });
      }));
    } catch (e) {}
    for (const name of CHROMIUMS) {
      try {
        const b = Application(name);
        if (b.running()) b.windows.tabs.url().forEach((tabs, wi) => tabs.forEach((u, ti) => {
          if (isAsana(u)) refs.push({ run: (js) => b.windows[wi].tabs[ti].execute({ javascript: js }) });
        }));
      } catch (e) {}
    }
    return refs;
  }

  // No Asana tab at all: open the ticket in a new Safari tab.
  function newSafariTab(url) {
    const s = Application('Safari');
    if (!s.running() || !s.windows.length) return null;
    const w = s.windows[0];
    w.tabs.push(s.Tab({ url }));
    const i = w.tabs.length - 1;
    return { run: (js) => s.doJavaScript(js, { in: w.tabs[i] }) };
  }

  function act(a) {
    if (a.action === 'switch') {
      const err = act({ ...a, id: a.id + ':stop', action: 'stop', gid: a.stopGid });
      return err || act({ ...a, id: a.id + ':start', action: 'start' });
    }
    let refs = tabRefs();
    // a tab already showing the button first
    refs.sort((x, y) => { const has = (r) => { try { return r.run(HAS_STOP) === true ? 0 : 1; } catch (e) { return 2; } }; return has(x) - has(y); });
    let tab = refs[0] || (a.url || a.gid ? newSafariTab(a.url || `https://app.asana.com/0/0/${a.gid}/f`) : null);
    if (!tab) return 'no Asana tab open';
    const end = Date.now() + 30000;
    let last = '';
    while (Date.now() < end) {
      try { last = tab.run(STEP(a.id, a.action, a.action === 'stop' ? a.stopGid || a.gid : a.gid)); } catch (e) { last = 'error'; }
      if (last === 'done') return null;
      delay(1);
    }
    return a.action === 'stop' ? 'Asana’s Stop button didn’t respond' : 'Asana’s Start timer button didn’t respond';
  }

  // Step in when a countdown ended and no Asana tab has acted yet.
  // Returns true when it did something (so we fetch the outcome).
  let lastTry = 0;
  function autoBackup() {
    const a = c && c.auto;
    if (!a || a.status !== 'pending' || !watching || Date.now() - lastTry < 10000) return false;
    const now = Date.now() + (c.serverNow - c.fetchedLocal);
    if (now < a.deadline + TABS_FIRST) return false;
    lastTry = Date.now();
    let j = null;
    try { const out = curl('POST', '/api/auto', { id: a.id, op: 'claim' }).split('\n'); out.pop(); j = JSON.parse(out.join('\n')); } catch (e) {}
    if (!j || !j.go) return false; // a tab got there first (or it's no longer needed); the next fetch shows it
    emit(`⏹ ${a.action === 'stop' ? 'Stopping' : a.action === 'switch' ? 'Switching' : 'Starting'} your timer… | font=Menlo size=12`);
    const err = act(j.rec || a);
    try { curl('POST', '/api/auto', { id: a.id, op: 'result', ok: !err, error: err || undefined }); } catch (e) {}
    return true;
  }

  const clean = (s) => String(s || '').replace(/\|/g, '¦').replace(/\n/g, ' ');
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60); return h ? `${h}h ${pad(m)}m` : `${m}m`; };
  const hms = (sec) => { sec = Math.max(0, Math.floor(sec)); return `${Math.floor(sec / 3600)}:${pad(Math.floor(sec % 3600 / 60))}:${pad(sec % 60)}`; };
  const action = (arg, arg2) => (self ? `bash=${JSON.stringify(self)} param1=${arg}${arg2 ? ` param2=${arg2}` : ''} terminal=false` : '');

  function render() {
    const L = [];
    if (!c) {
      L.push('◔ ⚠', '---', clean(problem || 'Loading…') + ' | color=#ff9f0a', `Open Tracket | href=${base}`, `Try again | ${action('refresh')}`);
      return L.join('\n');
    }
    const now = Date.now() + (c.serverNow - c.fetchedLocal);
    const runSec = c.running ? Math.max(0, (now - c.running.startedAt) / 1000) : 0;
    const total = c.loggedMin * 60 + runSec;
    const bell = c.unread ? `🔔${c.unread} ` : '';
    const au = c.auto && c.auto.status === 'pending' ? c.auto : null;
    const auLeft = au ? Math.max(0, Math.ceil((au.deadline - now) / 1000)) : 0;
    // monospaced digits so the title doesn't wobble as seconds change
    const tag = au ? `⏹${auLeft ? auLeft + 's' : '…'} ` : '';
    L.push(c.running ? `${tag}${bell}● ${hms(runSec)} · ${hms(total)} | font=Menlo size=12` : `${tag}${bell}◔ ${hm(total)}`);
    L.push('---');
    if (au && au.kind !== 'manual') L.push(`${au.kind === 'failsafe' ? 'Failsafe' : 'Auto mode'}: ${clean(au.title.replace(/ in \d+s/, ''))} | color=#ffb547`, ...(au.noDeny ? [] : [`Deny | ${action('deny', au.id)}`]), '---');
    if (c.running) L.push(`● ${clean(c.running.name || 'Untitled task')} | href=${c.running.url} length=60 color=#ff4d6d`, `Running for ${hms(runSec)} | size=12 font=Menlo`, `■ Stop timer | ${action('stop')}`);
    else L.push('Nothing ticking | color=gray', ...(c.next ? [`▶ Start “${clean(c.next.name)}” | ${action('start')} length=60`] : []));
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
    if (c.unread && self) L.push(`Mark all read | ${action('seen')}`);
    L.push('---', `Updated ${Math.round((Date.now() - c.fetchedLocal) / 1000)}s ago · Refresh now | ${action('refresh')} size=11`);
    if (watching === false && blindWhy) L.push(`For instant updates: ${clean(blindWhy)} | size=11 color=gray`);
    L.push(`Open Tracket | href=${c.site || base}`);
    return L.join('\n');
  }

  // Run once from Terminal (for testing); stream forever under SwiftBar.
  if (!env('SWIFTBAR')) { if (!c || Date.now() - c.fetchedLocal > FETCH_EVERY) fetchNow(); return render(); }
  const out = $.NSFileHandle.fileHandleWithStandardOutput;
  const emit = (s) => out.writeData($('~~~\n' + s + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
  let lastFetch = c ? c.fetchedLocal : 0, lastWatch = 0, sig, again = 0;
  var watching = null;
  // how often to fetch: faster near the daily limit and while auto mode is pending
  function fetchEvery() {
    if (!watching) return FETCH_BLIND;
    if (c && c.auto && (c.auto.status === 'pending' || c.auto.status === 'running')) return FETCH_AUTO;
    if (c && c.cap && c.running) {
      const now = Date.now() + (c.serverNow - c.fetchedLocal);
      const left = c.cap * 3600 - (c.loggedMin * 60 + (now - c.running.startedAt) / 1000);
      if (left < 180 && left > -120) return FETCH_NEAR;
    }
    return FETCH_EVERY;
  }
  for (;;) {
    let changed = false;
    if (Date.now() - lastWatch >= WATCH_EVERY) {
      lastWatch = Date.now();
      const now = asanaTabs();
      watching = now !== null;
      if (sig !== undefined && now !== null && now !== sig) changed = true;
      sig = now;
    }
    const forced = readFile(cache) === '';
    // a start/stop in Asana: fetch now, and again shortly after (Asana takes a
    // few seconds to log a stopped timer)
    if (changed) again = Date.now() + 4000;
    const due = Date.now() - lastFetch > fetchEvery();
    if (forced || changed || due || (again && Date.now() >= again)) {
      if (again && Date.now() >= again) again = 0;
      fetchNow(); lastFetch = Date.now();
    }
    if (autoBackup()) { fetchNow(); lastFetch = Date.now(); }
    emit(render());
    delay(1);
  }
}
