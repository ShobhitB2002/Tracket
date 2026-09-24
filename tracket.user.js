// ==UserScript==
// @name         Tracket · Asana timer bridge
// @namespace    https://github.com/ShobhitB2002/Tracket
// @description  Sends your running Asana timer to your Tracket dashboard, live, and runs Tracket's auto mode.
// @version      2.4
// @homepageURL  https://github.com/ShobhitB2002/Tracket
// @match        https://app.asana.com/*
// @exclude      https://app.asana.com/-/*
// @noframes
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      vercel.app
// @connect      *
// @inject-into  content
// @run-at       document-idle
// ==/UserScript==

// ─────────────────────────── CONFIGURE ME ───────────────────────────
// Where your Tracket runs, e.g. 'https://your-tracket.vercel.app'
const TRACKET_URL = 'http://localhost:3000';
// Your TRACKET_SECRET (the password you set in Vercel). Leave '' when running locally without one.
const TRACKET_KEY = '';
// ─────────────────────────────────────────────────────────────────────

(function () {
  'use strict';
  if (window.top !== window.self) return; // ignore Asana's embedded iframes

  const VERSION = '2.4';
  const BASE = TRACKET_URL.replace(/\/+$/, '');
  const SERVER = BASE + '/api/event';
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } })();
  const ATTR = 'data-tracket-timer';
  const log = (...a) => console.log('%c[Tracket]', 'color:#ffb547;font-weight:bold', ...a);

  // ---------------------------------------------------------------------------
  // 1) Page-world reader. The userscript runs in an isolated world that can't
  //    see Asana's React data, so we inject a small script into the page. It
  //    reads Asana's own `activeTimer` (task id + exact start ms) and mirrors it
  //    into DOM attributes, which both worlds share. Asana's CSP uses a nonce +
  //    'strict-dynamic', so the script carries Asana's nonce.
  // ---------------------------------------------------------------------------
  const page = `(() => {
    if (window.__tracketReader) return;
    window.__tracketReader = ${JSON.stringify(VERSION)};
    const ATTR = ${JSON.stringify(ATTR)};
    const de = document.documentElement;
    function findTimer() {
      const el = document.querySelector('.TimeTrackingActiveTimerPopOut, .ActiveTimerStopButton, .ActiveTimerStopButton-label');
      if (!el) return { state: 'none' };
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
      let f = key && el[key];
      for (let i = 0; f && i < 60; i++, f = f.return) {
        const p = f.memoizedProps;
        if (!p || typeof p !== 'object') continue;
        for (const k in p) {
          const v = p[k];
          if (v && typeof v === 'object' && v.taskId && v.taskId.id && typeof v.startTime === 'number') {
            if (typeof v.endTime === 'number' && v.endTime > 0) return { state: 'none' };
            const label = document.querySelector('.TimerPopOutStructure-taskLabel');
            return { state: 'running', taskGid: String(v.taskId.id), startedAt: v.startTime,
                     taskName: (label && label.textContent.trim()) || null };
          }
        }
      }
      return { state: 'unknown' }; // widget there but data not found
    }
    function run() {
      let t;
      try { t = findTimer(); } catch (e) { t = { state: 'error', error: String(e).slice(0, 80) }; }
      const next = JSON.stringify(t);
      if (de.getAttribute(ATTR) !== next) de.setAttribute(ATTR, next);
      de.setAttribute(ATTR + '-alive', String(Date.now()));
    }
    run();
    setInterval(run, 1000);
    // react to Asana re-rendering the timer widget immediately
    new MutationObserver(() => { clearTimeout(run.t); run.t = setTimeout(run, 50); })
      .observe(document.body, { childList: true, subtree: true });
    document.addEventListener('visibilitychange', run);
  })();`;

  function inject() {
    const nonced = document.querySelector('script[nonce]');
    const nonce = nonced && (nonced.nonce || nonced.getAttribute('nonce'));
    const s = document.createElement('script');
    if (nonce) s.nonce = nonce;
    s.textContent = page;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  }
  inject();

  // ---------------------------------------------------------------------------
  // 2) Sender (userscript world): reads the attribute and reports to Tracket.
  //    - running timers are reported from any tab (server keeps the newest start)
  //    - "stopped" is only reported by the tab you're looking at, after 2
  //      consecutive empty reads, and only if this tab saw that timer running.
  //      Background tabs go stale in Asana, so they never get to say "stopped".
  // ---------------------------------------------------------------------------
  const xhr = (typeof GM !== 'undefined' && GM.xmlHttpRequest) || (typeof GM_xmlhttpRequest !== 'undefined' && GM_xmlhttpRequest);
  if (!xhr) log('❌ GM.xmlHttpRequest unavailable');
  // Failed sends must be visible: Safari can block the request (Userscripts not
  // allowed on the Tracket site) without ever calling back, so a send that gets
  // no answer within 20s counts as failed too.
  let failing = false;
  let waiting = 0; // time of the oldest unanswered send
  function ok() {
    waiting = 0;
    if (failing) log('✅ connected');
    failing = false;
    badge(null);
  }
  function fail(why) {
    waiting = 0;
    if (!failing) log('❌', why);
    failing = true;
    badge(why);
  }
  const HOST = (() => { try { return new URL(TRACKET_URL).host; } catch { return TRACKET_URL; } })();
  const blocked = `Tracket can’t reach ${HOST}. Allow your userscript manager on ${HOST} (Safari: Userscripts icon → Always Allow), then reload this tab.`;
  function post(body) {
    if (!xhr) return fail('GM.xmlHttpRequest unavailable — is this running in Tampermonkey or Userscripts?');
    if (!waiting) waiting = Date.now();
    try {
      xhr({
        method: 'POST', url: SERVER, data: JSON.stringify({ ...body, tz: TZ }), timeout: 15000,
        headers: { 'Content-Type': 'application/json', ...(TRACKET_KEY ? { 'x-tracket-key': TRACKET_KEY } : {}) },
        onload: (r) => {
          if (r.status === 401) return fail('This script’s key is no longer valid — reinstall it from Tracket → Settings.');
          if (r.status >= 200 && r.status < 300) {
            ok();
            try { const j = JSON.parse(r.responseText); onAuto(j.auto, j.now); } catch {}
            return;
          }
          if (r.status === 0) return fail(blocked);
          waiting = 0; // server hiccup: the next beat retries
        },
        onerror: () => fail(blocked),
        ontimeout: () => fail(blocked),
      });
    } catch { fail(blocked); }
  }
  setInterval(() => { if (waiting && Date.now() - waiting > 20000) fail(blocked); }, 5000);

  // Small warning pill in the Asana tab while sends fail; × hides it for 10 min.
  let hiddenUntil = 0;
  function badge(msg) {
    let el = document.getElementById('tracket-badge');
    if (!msg || Date.now() < hiddenUntil) { if (el) el.remove(); return; }
    if (!document.body) return;
    if (!el) {
      el = document.createElement('div');
      el.id = 'tracket-badge';
      el.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;max-width:360px;padding:10px 34px 10px 12px;' +
        'background:#1b1b1f;color:#f4f4f5;border:1px solid #ffb547;border-radius:10px;font:13px/1.4 -apple-system,system-ui,sans-serif;box-shadow:0 6px 24px #0006';
      const x = document.createElement('button');
      x.textContent = '×';
      x.title = 'Hide for 10 minutes';
      x.style.cssText = 'position:absolute;top:4px;right:6px;background:none;border:0;color:#aaa;font-size:18px;cursor:pointer';
      x.onclick = () => { hiddenUntil = Date.now() + 600000; el.remove(); };
      const t = document.createElement('span');
      el.append(t, x);
      document.body.appendChild(el);
    }
    el.firstChild.textContent = '◔ ' + msg;
  }

  // One Asana tab is the leader (the one you look at wins); the others stay
  // quiet unless something changes. Kept in Asana's localStorage, shared by tabs.
  const BEAT_MS = 60000;
  const LEAD = 'tracket-leader';
  const me = Math.random().toString(36).slice(2);
  function isLeader() {
    let cur = null;
    try { cur = JSON.parse(localStorage.getItem(LEAD) || 'null'); } catch {}
    const now = Date.now();
    if (!cur || cur.id === me || now - cur.at > 20000 || (!document.hidden && cur.hidden)) {
      try { localStorage.setItem(LEAD, JSON.stringify({ id: me, at: now, hidden: document.hidden })); } catch { return true; }
      return true;
    }
    return false;
  }
  setInterval(isLeader, 5000); // keeps the lease fresh (or takes over from a closed tab)

  let seen = null;      // timer this tab last saw running
  let emptyReads = 0;
  let lastKey = null;
  let lastBeat = 0;

  function read() {
    const raw = document.documentElement.getAttribute(ATTR);
    if (!raw) return { state: 'noreader' };
    try { return JSON.parse(raw); } catch { return { state: 'error' }; }
  }

  function check() {
    const t = read();
    const visible = !document.hidden;
    let running = null, previous = null;

    if (t.state === 'running') {
      running = { taskGid: t.taskGid, startedAt: t.startedAt, taskName: t.taskName, url: `https://app.asana.com/0/0/${t.taskGid}/f` };
      seen = { taskGid: t.taskGid, startedAt: t.startedAt };
      emptyReads = 0;
    } else if (t.state === 'none') {
      emptyReads++;
      if (seen && visible && emptyReads >= 2) { previous = seen; seen = null; }
    }

    const key = running ? `R${running.startedAt}` : previous ? `S${previous.startedAt}` : `-${t.state}`;
    const now = Date.now();
    // Changes go out at once from any tab. The "still here" heartbeat comes from
    // one tab only (the leader), every 60s — every 2s while auto mode counts down.
    const beatDue = auto ? now - lastBeat > 2000 : isLeader() && now - lastBeat > BEAT_MS;
    if (key !== lastKey || beatDue) {
      if (key !== lastKey) log(running ? `running: ${running.taskName || running.taskGid}` : previous ? 'stopped' : `no timer (${t.state})`);
      post({ running, previous, visible, diag: { v: VERSION, state: t.state, visible, reader: !!document.documentElement.getAttribute(ATTR + '-alive') } });
      lastKey = key;
      lastBeat = now;
    }
  }

  // ---------------------------------------------------------------------------
  // 3) Auto mode. Tracket's answer can carry an action (stop at X hours, stop
  //    for lunch, restart after lunch). This tab shows a 25-second countdown
  //    with Deny; when it runs out, one tab claims the action and presses
  //    Asana's own timer button. Denying in Tracket or here cancels it.
  // ---------------------------------------------------------------------------
  const INTENT = 'tracket-auto-start';
  let auto = null;          // action being counted down
  let skew = 0;             // server clock − ours
  let acting = false;
  let claimAfter = 0;
  let countT = null;
  const denied = new Set();

  function api(path, body, cb) {
    if (!xhr) return cb && cb(null);
    try {
      xhr({
        method: 'POST', url: BASE + path, data: JSON.stringify(body), timeout: 15000,
        headers: { 'Content-Type': 'application/json', ...(TRACKET_KEY ? { 'x-tracket-key': TRACKET_KEY } : {}) },
        onload: (r) => { let j = null; try { j = JSON.parse(r.responseText); } catch {} if (cb) cb(r.status >= 200 && r.status < 300 ? j : null); },
        onerror: () => cb && cb(null), ontimeout: () => cb && cb(null),
      });
    } catch { if (cb) cb(null); }
  }

  function onAuto(a, serverNow) {
    if (serverNow) skew = serverNow - Date.now();
    if (acting) return;
    if (!a || a.status !== 'pending' || denied.has(a.id)) { if (auto) hideCountdown(); auto = null; return; }
    if (!auto || auto.id !== a.id) { auto = a; claimAfter = 0; clearInterval(countT); countT = setInterval(tickCountdown, 250); tickCountdown(); }
  }

  const stopBtn = () => document.querySelector('[aria-label="Stop timer"], .ActiveTimerStopButton');
  const startBtn = () => document.querySelector('[aria-label="Start timer"]');
  const target = (el) => (el && (el.closest('[role=button],button') || el));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, ms) { const end = Date.now() + ms; for (;;) { const v = fn(); if (v || Date.now() > end) return v; await sleep(250); } }
  // A plain click first; only if Asana ignored it, a pointer/mouse press.
  // (Never both at once — a button handling both would toggle twice.)
  const clickOnce = (el) => target(el).click();
  function pressDown(el) {
    el = target(el);
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      const E = t.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
      el.dispatchEvent(new E(t, { bubbles: true, cancelable: true, composed: true }));
    }
  }

  async function doStop() {
    const b = stopBtn();
    if (!b) return 'Asana’s stop button wasn’t found in this tab';
    clickOnce(b);
    if (await waitFor(() => read().state === 'none', 3000)) return null;
    const again = stopBtn();
    if (again) pressDown(again);
    return (await waitFor(() => read().state === 'none', 4000)) ? null : 'Asana didn’t stop the timer';
  }

  async function startOn(gid) {
    const b = await waitFor(() => location.href.includes(gid) && startBtn(), 20000);
    if (!b) return 'Asana’s Start timer button wasn’t found';
    const ok = () => { const t = read(); return t.state === 'running' && String(t.taskGid) === String(gid); };
    clickOnce(b);
    if (await waitFor(ok, 3000)) return null;
    const again = startBtn();
    if (again) pressDown(again);
    return (await waitFor(ok, 4000)) ? null : 'Asana didn’t start the timer';
  }

  async function doStart(a) {
    const here = () => location.href.includes(a.gid) && startBtn();
    if (!here()) {
      // open the ticket in place; if Asana doesn't route that, load it (the next page finishes the job)
      history.pushState(null, '', `/0/0/${a.gid}/f`);
      dispatchEvent(new PopStateEvent('popstate'));
      if (!(await waitFor(here, 6000))) {
        try { sessionStorage.setItem(INTENT, JSON.stringify({ id: a.id, gid: a.gid, at: Date.now() })); } catch {}
        location.assign(a.url || `https://app.asana.com/0/0/${a.gid}/f`);
        return new Promise(() => {});
      }
    }
    return startOn(a.gid);
  }

  function finish(a, err) {
    api('/api/auto', { id: a.id, op: 'result', ok: !err, error: err || undefined });
    acting = false; auto = null; hideCountdown();
    const verb = a.action === 'stop' ? 'stop' : 'restart';
    flash(err ? `Tracket couldn’t ${verb} your timer: ${err}. Please do it by hand.` : a.action === 'stop' ? 'Tracket stopped your timer ✦' : 'Tracket restarted your timer ✦', !!err);
  }

  function claim(a) {
    if (a.action === 'stop' && !(read().state === 'running' && stopBtn())) { claimAfter = Date.now() + 2000; return card(a, null, 'Waiting for the Asana tab that shows your timer…'); }
    claimAfter = Date.now() + 1500;
    api('/api/auto', { id: a.id, op: 'claim' }, (j) => {
      if (!j || auto?.id !== a.id) return;
      if (!j.go) { if (j.status !== 'pending') { auto = null; hideCountdown(); } return; }
      acting = true;
      card(a, null, a.action === 'stop' ? 'Stopping your timer…' : 'Restarting your timer…');
      (a.action === 'stop' ? doStop() : doStart(a)).then((err) => finish(a, err), (e) => finish(a, String(e).slice(0, 80)));
    });
  }

  function tickCountdown() {
    if (!auto) return hideCountdown();
    if (acting) return;
    const left = auto.deadline - (Date.now() + skew);
    card(auto, left);
    // the tab you're looking at gets first go; background tabs wait 1.5s more
    if (left <= (document.hidden ? -1500 : 0) && Date.now() > claimAfter) claim(auto);
    if (left < -60000) { auto = null; hideCountdown(); }
  }

  function hideCountdown() { clearInterval(countT); countT = null; document.getElementById('tracket-auto')?.remove(); }

  // The countdown card: what's about to happen, seconds left, Deny.
  function card(a, left, note) {
    if (!document.body) return;
    let el = document.getElementById('tracket-auto');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tracket-auto';
      el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;width:min(420px,calc(100vw - 32px));padding:14px 16px;' +
        'background:#16161f;color:#f3efe6;border:1px solid #ffb547;border-radius:16px;font:14px/1.4 -apple-system,system-ui,sans-serif;box-shadow:0 18px 50px #000a';
      el.innerHTML = '<div style="display:flex;align-items:center;gap:12px"><div style="flex:1;min-width:0"><div style="font:700 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.18em;color:#ffb547;margin-bottom:6px">TRACKET · AUTO MODE</div>' +
        '<div data-t style="font-weight:600"></div><div data-n style="color:#8a879a;font-size:12px;margin-top:2px"></div></div>' +
        '<div data-s style="font:800 30px/1 ui-monospace,Menlo,monospace;color:#ffb547;min-width:44px;text-align:right"></div>' +
        '<button data-deny style="border:1px solid #ff4d6d;background:#ff4d6d22;color:#ff9aac;border-radius:10px;padding:9px 14px;font:700 13px -apple-system,system-ui,sans-serif;cursor:pointer">Deny</button></div>' +
        '<div style="height:4px;border-radius:4px;background:#262635;margin-top:12px;overflow:hidden"><i data-b style="display:block;height:100%;background:#ffb547;width:100%;transition:width .25s linear"></i></div>';
      el.querySelector('[data-deny]').onclick = () => {
        const id = auto?.id; if (!id) return;
        denied.add(id);
        api('/api/auto', { id, op: 'deny' });
        auto = null; hideCountdown(); flash('Denied — Tracket won’t do it today.');
      };
      document.body.appendChild(el);
    }
    el.querySelector('[data-t]').textContent = a.title.replace(/ in 25s/, '');
    const secs = left == null ? null : Math.max(0, Math.ceil(left / 1000));
    el.querySelector('[data-s]').textContent = secs == null ? '' : String(secs);
    el.querySelector('[data-n]').textContent = note || (secs ? `Happens in ${secs}s unless you deny it.` : 'Doing it now…');
    el.querySelector('[data-b]').style.width = left == null ? '0%' : `${Math.max(0, Math.min(1, left / 25000)) * 100}%`;
    el.querySelector('[data-deny]').style.display = acting ? 'none' : '';
  }

  function flash(msg, bad) {
    if (!document.body) return;
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;max-width:420px;padding:10px 14px;background:#16161f;color:#f3efe6;border:1px solid ${bad ? '#ff4d6d' : '#5cf2b0'};border-radius:12px;font:13px/1.4 -apple-system,system-ui,sans-serif;box-shadow:0 10px 30px #0008`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), bad ? 12000 : 5000);
  }

  // A restart that had to load the ticket's page finishes here.
  try {
    const it = JSON.parse(sessionStorage.getItem(INTENT) || 'null');
    sessionStorage.removeItem(INTENT);
    if (it && Date.now() - it.at < 60000) {
      acting = true;
      flash('Tracket is restarting your timer…');
      startOn(it.gid).then((err) => finish({ id: it.id, action: 'start' }, err));
    }
  } catch {}

  // Poll fast, and also react instantly to the page reader updating.
  setInterval(check, 1000);
  new MutationObserver(check).observe(document.documentElement, { attributes: true, attributeFilter: [ATTR] });
  document.addEventListener('visibilitychange', () => { inject(); check(); });
  log('bridge', VERSION, 'loaded');
})();
