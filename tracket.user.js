// ==UserScript==
// @name         Tracket · Asana timer bridge
// @namespace    https://github.com/ShobhitB2002/Tracket
// @description  Sends your running Asana timer to your Tracket dashboard, live.
// @version      2.1
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

  const VERSION = '2.1';
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
  let failing = false;
  function post(body) {
    if (!xhr) return;
    xhr({
      method: 'POST', url: SERVER, data: JSON.stringify({ ...body, tz: TZ }),
      headers: { 'Content-Type': 'application/json', ...(TRACKET_KEY ? { 'x-tracket-key': TRACKET_KEY } : {}) },
      onload: (r) => {
        if (r.status === 401) { if (!failing) log('❌ wrong TRACKET_KEY — check the top of this script'); failing = true; return; }
        if (failing) log('✅ connected'); failing = false;
      },
      onerror: () => { if (!failing) log('❌ cannot reach', SERVER); failing = true; },
    });
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
