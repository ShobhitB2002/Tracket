// ==UserScript==
// @name         Tracket · Asana timer bridge
// @namespace    https://github.com/ShobhitB2002/Tracket
// @description  Sends your running Asana timer to your Tracket dashboard, live.
// @version      2.2
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

  const VERSION = '2.2';
  const SERVER = TRACKET_URL.replace(/\/+$/, '') + '/api/event';
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
          if (r.status >= 200 && r.status < 300) return ok();
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
    if (key !== lastKey || now - lastBeat > 15000) {
      if (key !== lastKey) log(running ? `running: ${running.taskName || running.taskGid}` : previous ? 'stopped' : `no timer (${t.state})`);
      post({ running, previous, visible, diag: { v: VERSION, state: t.state, visible, reader: !!document.documentElement.getAttribute(ATTR + '-alive') } });
      lastKey = key;
      lastBeat = now;
    }
  }

  // Poll fast, and also react instantly to the page reader updating.
  setInterval(check, 1000);
  new MutationObserver(check).observe(document.documentElement, { attributes: true, attributeFilter: [ATTR] });
  document.addEventListener('visibilitychange', () => { inject(); check(); });
  log('bridge', VERSION, 'loaded');
})();
