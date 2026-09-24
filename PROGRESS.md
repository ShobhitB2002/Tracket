# Tracket: project notes & progress

The working memory for this project: what exists, why it's built that way, what's
been done, and what's open. Update it at the end of each piece of work.
(README.md is the user-facing overview. This file is for whoever works on it next.)

## At a glance

- **Live site:** https://tracketv1.vercel.app (Vercel, auto-deploys from `main`)
- **Repo:** https://github.com/ShobhitB2002/Tracket
- **Owner / admin:** Shobhit Bansal. Admin panel at `/admin` (password = `ADMIN_PASSWORD` env var)
- **Stack:** Node 18+, zero npm dependencies, no build step. Vercel function (Hobby) + Turso (libSQL over HTTP), Upstash Redis as the older fallback
- **Goal:** stay on free tiers for up to ~10 members (see *Free-tier budget*)
- **Members:** invite-only. Visitors see a demo and can request access; the admin approves; the member gets a login by email (Resend)

## How it works

```
Asana tab (userscript) --POST /api/event (x-tracket-key)--> per-member state in Redis
Tracket dashboard --polls /api/live every 2s, /api/today on change--> server
server --member's Asana PAT (AES-256-GCM at rest)--> Asana API (time_tracking_entries, tasks)
```

- **Logged time** comes from Asana's API, server side only. It's refreshed at most every 20s (lock `u:<id>:poll`).
- **Running timer:** it isn't in Asana's public API. `tracket.user.js` injects a page-world reader that finds Asana's
  React `activeTimer` (task id + exact start ms) and mirrors it into `data-tracket-timer` on `<html>`. The
  userscript-world sender posts it with `GM.xmlHttpRequest`: on every change, plus a heartbeat every 15s.
- **Stale-tab rules** (`lib/core.js` onReport): a newer start always wins. "Stopped" is only accepted from the visible tab.
  A stop only becomes final once Asana logs the entry (reconcileRunning), or after 25s (settleSuspect).
- **Alerts engine** (`lib/alerts.js`): every reminder is decided on the server so it works with no tab open.
  `evaluate()` runs on userscript heartbeats (`/api/event`), dashboard polls (`/api/live`), the menu bar (`/api/bar`) and
  `/api/cron`, at most every ~12s per member (lock `evalgap`). `autoStep()` (auto mode) runs on heartbeats only, since
  only an open Asana tab can press Asana's buttons. Alerts go to a feed (`alerts`) and to every Web Push device.
- **Isolation:** every member key is `u:<id>:*`. Keys: `pat, me, state, hb, names, seen, shift, chk, day:<date>, tasks:<date>`,
  plus `prefs, push, alerts, rt:<date>, auto:<date>, autost:<id>, autonow, sess:<date>, cmt:<date>, lunchfix, reportlast`.
  Global keys: `members, apikeys, requests, rl:*, vapid` (Web Push key pair, private half encrypted).

### Files
| File | Role |
|---|---|
| `api/router.js` | the single Vercel function for all `/api/*` (vercel.json rewrites to `?__path=`) |
| `lib/routes.js` | route table (public / member / admin), per-member userscript generation, shift API |
| `lib/core.js` | Asana client, day summaries, running-timer rules, ticket ownership checks |
| `lib/users.js` | members, requests, sessions (HMAC cookies `tk_s` / `tk_a`), API keys, rate limits |
| `lib/store.js` | Turso (preferred) or Upstash Redis or a local JSON file; `mget`, `lock`, in-memory `throttle`, per-instance read cache, one-time Upstash → Turso copy |
| `lib/crypto.js`, `lib/notify.js` | scrypt/HMAC/AES, cron key; access-request pings + `sendEmail` (Resend) |
| `lib/alerts.js` | reminder engine, alert feed, auto mode (offer → countdown → claim/deny → result) |
| `lib/push.js` | Web Push with no deps: VAPID ES256 JWT + aes128gcm (RFC 8291), subscriptions per member |
| `lib/report.js` | end-of-day email report |
| `lib/prefs.js` | member prefs: tz, lunch, auto mode, report |
| `public/sw.js`, `public/manifest.webmanifest`, `public/*.png` | service worker (push, Deny action), Home Screen app manifest + icons |
| `tracket.menubar.js` | SwiftBar plugin template (JavaScript for Automation). `/api/menubar` fills in URL + key |
| `public/index.html` | the whole dashboard (plain HTML/CSS/JS) |
| `public/admin.html` | admin panel |
| `tracket.user.js` | the userscript template. `/api/userscript` fills in URL, key, @name, @namespace |

### Env vars (Vercel)
`ADMIN_PASSWORD`, `SESSION_SECRET` (16+ chars; changing it logs everyone out, and also resets the push keys and cron URL),
`GMAIL_USER` + `GMAIL_APP_PASSWORD` (a Gmail made for Tracket sends all email over SMTP; owner's choice, no domain), `ADMIN_EMAIL`,
`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (set by Vercel's Turso integration), fallback `RESEND_API_KEY`/`RESEND_FROM`, optional `CRON_SECRET` (Bearer for a scheduler),
optional `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (otherwise generated and stored). The Upstash integration sets `KV_REST_API_URL`/`KV_REST_API_TOKEN`. See `.env.example`.

## Features & rules (current)

- **Day health** (`public/index.html` → `VERDICTS`, `verdict()`): under 7h / 7h+ / 8h+ messages under the day bar.
  Today uses the owner's lines (grammar tidied); past days get past-tense variants. There's a 7h marker on the tape.
- **Work shift** (`POST /api/shift`, stored at `u:<id>:shift` = `{days:{0-6:{start,end}}}`, 0 = Sunday, local time; no overnight):
  a shift card shows time left, a **pace score** (100 = on pace for 7h, computed as logged ÷ (7h × elapsed/shift length)), and the
  projected total. After the shift or on past days, the score is total ÷ 7h.
- **Reminders** (server side since 2026-09-24, `lib/alerts.js`; once per day per key in `rt:<date>.sent`):
  - crossing 7h → one. Crossing 8h → one (jumping straight past 8h sends only the 8h one)
  - under 7h: a timer stop within the last 30 min of the shift → one. Shift end (within 15 min, day's peak total) → one
  - ⚠ on every start of a ticket that may not be yours
  - 💬 on every timer stop when you haven't commented on that ticket that day, and one summary at shift end
  - 🍽 once after lunch ends if logged time fell inside lunch
  - Delivery: Web Push to every subscribed device + the feed. The dashboard polls `/api/alerts` every 15s, toasts new
    ones (plus a browser notification if this device has no push) and marks them seen; the 🔔 in the header lists them.
- **Web Push:** Settings → Notifications → *Turn on for this device*. iPhone/iPad need Tracket added to the Home Screen
  (iOS 16.4+) and a login inside that app. Watches get them through the phone's notification mirroring. Chrome/Android show a
  **Deny** button on auto-mode notifications (service worker posts `/api/auto` deny); Safari has no buttons.
- **Auto mode** (prefs `auto.cap {on, hours}` default 7h, `auto.lunch` + `lunch {start,end}`), configured from the ⚙ row under the shift card:
  - cap: timer running and today ≥ X h → offer "stop". lunchStop: running inside lunch → "stop". lunchResume: lunch stop
    was done, nothing running, within 30 min after lunch end → "start" on the same ticket
  - each kind at most once a day (a Deny or a restart means it won't come back). Only offered while the Asana tab reports (fresh heartbeat)
  - 25s countdown (`COUNTDOWN`) shown in the Asana tab (userscript card with Deny) and on the dashboard; push too
  - whoever takes `lock:autoclaim:<id>` first decides: a tab's claim (after the deadline; visible tab first, background +1.5s),
    a Deny, or the timeout (deadline + 45s → missed). Result → `autost:<id>` + an alert
  - the userscript presses Asana's own buttons: Stop = `[aria-label="Stop timer"]` / `.ActiveTimerStopButton`,
    Start = `[aria-label="Start timer"]` in the task pane (opens the task via pushState, else loads it and finishes after reload).
    A plain click first; a pointer/mouse press only if Asana ignored it (never both, to avoid a double toggle)
  - no fallback by design: if the Asana tab is closed nothing happens (owner's call: risky to edit time on our own)
- **Lunch:** lunch shows as a hatched band on the shift bar, and logged time inside lunch is hatched on the day tape.
  Lunch minutes are only computed for entries made by a timer Tracket saw start (`sess:<date>`, start = created_at − duration,
  ±3 min), never manual entries. A ticket with lunch time gets "🍽 Xm during lunch · Remove lunch": `PUT /time_tracking_entries/<gid>`
  with the lunch minutes taken off (Tracket's only write to Asana, on click only). Fixed entries are kept in `lunchfix`.
- **Comments:** `commentsFor` reads each ticket's stories; ok = a `comment_added` by you that day (your tz). Yes is kept for the
  day, no re-checked every 90s. Chip: "💬 Dude, you forgot to mention what you did on this ticket. All good?" (owner's line, grammar tidied).
- **Daily email report** (`lib/report.js`, opt-in in Settings): sent 30 min after shift end (20:00 without a shift) by whichever
  trigger runs first after that; a day missed is sent late the next day (if reports were on by then). "Send today's report now"
  in Settings. Account email is changeable in Settings (needs password; also the login).
- **Scheduler:** `/api/cron?key=<cronKey>` (key derived from SESSION_SECRET; the admin panel shows the URL) runs `evaluate` for
  every member and sweeps expired rows. Point Upstash QStash (Schedules, every 10 min = 144 msgs/day, free tier) or cron-job.org at it. Without it,
  reminders and reports still run whenever an Asana tab, dashboard or the menu bar is open.
- **Menu bar (Mac):** SwiftBar *streamable* plugin `tracket.js` (v2): one long-running process redraws every second (`~~~` frames),
  fetches `/api/bar` once a minute, counts the timer locally → title `🔔2 ● 0:47:12 · 6:47:12` (Menlo, so digits don't wobble).
  Menu actions (`seen`, `refresh`) run the file again with an argument and empty the cache file to make the loop refetch.
  Settings → Menu bar → *Copy install command* (also removes the old `tracket.10s.js`).
  v2.1 real-time: every 2s it reads `data-tracket-timer` from open Asana tabs in Safari/Chrome/Brave/Edge over Apple Events
  (needs "Allow JavaScript from Apple Events" + macOS Automation permission for SwiftBar); any change → fetch now and again
  after 4s. Can't see tabs → fetches every 30s and shows how to enable it.
- **Email:** `lib/notify.js` sends through Gmail SMTP (implicit TLS 465, AUTH PLAIN, multipart text+HTML, UTF-8 subject) when
  `GMAIL_USER`/`GMAIL_APP_PASSWORD` are set, else Resend. Also used for access-request pings to `ADMIN_EMAIL`.
  Admin panel → Scheduler → *Check email* logs in to Gmail and quits (nothing sent). Tracket's Gmail: tracket.vuseia@gmail.com.
- **Guide:** `/guide` (`public/guide.html`) — step-by-step for non-technical members: setup, notifications per device, auto mode,
  lunch, comments, email, menu bar, troubleshooting. Linked from Settings, the footer, the script setup and the admin welcome message.
- **"Is this really your ticket?"** (`core.js` judge/checkTasks; cache `u:<id>:chk`, 30s):
  OK = assigned to me AND the custom field "Task Status" is "In Grooming" or "In Development". Otherwise a ⚠ chip
  appears on the row and On Air card, and an alert fires on **every** timer start (by design, the owner wants it repeated).
  No Task Status field → the assignee is still checked, and it's flagged "No Task Status field — are you sure that's acceptable?"
  Checks never throw (so there are no false warnings when Asana fails).
- **Userscript v2.4:** only one Asana tab (the leader, via `tracket-leader` in Asana's localStorage; the visible tab takes over)
  sends the 60s heartbeat; any tab still reports a start/stop instantly; 2s beats during an auto countdown. v2.3 added auto mode.
  The dashboard shows "Install v2.4" when an older one reports (`SCRIPT_V`). v2.2 added per-member `@name Tracket · <name>` / `@namespace tracket/<id>`. A warning pill shows in the Asana
  tab when sends error, time out, or get no answer in 20s. The dashboard says "Asana tab stopped reporting X ago" and gives the fix.

## Free-tier budget (target: ≤10 members, all free)

Limits: Vercel Hobby 1M function calls, 4 h active CPU, 360 GB-h memory a month (and non-commercial use only);
Turso 500M row reads / 10M row writes; Upstash 500K commands; QStash 1,000 msgs/day, 10 schedules; Gmail ~500 emails/day.

Measured 2026-09-24 with a 3-minute replay (dashboard focused, 3 Asana tabs, menu bar, timer running), mocks counting every call:

| | old (f7db29a, Upstash) | new (Turso) |
|---|---|---|
| requests / hour | 2,880 | 1,040 focused all the time; ~300 typical |
| database ops / hour | 31,200 Redis commands | 780 row writes + 5,900 row reads |
| CPU per request | — | ~10 ms |

Old: one member used Upstash's monthly 500K in about two workdays (live poll every 2s ≈ 11 commands each, heartbeats every 15s
from every Asana tab ≈ 12 each, plus alert/menu-bar polling). New: ~64K requests / month per typical member → 10 members ≈ 64%
of Vercel's 1M; Turso writes ≈ 4% of 10M. Rules that keep it there: dashboard polls 4s focused / 12s visible / 90s hidden;
Asana refresh 30s (90s background); one heartbeat tab at 60s; `mget` per request; skip no-op state writes; in-memory throttles
before any lock write; alerts fetched only when `alertsHead` changes; menu bar fetch 60s. Check usage monthly in Vercel → Usage.

## History

| Date | Commit | What |
|---|---|---|
| 2026-09-23 | 94a5c1e | First version: live dark-mode dashboard for Asana time tracking |
| 2026-09-23 | 5e91610 | v3: members-only, admin panel, access requests |
| 2026-09-24 | e461112…48997eb | Vercel /api path fixes, `/api/health`, admin tweaks, onboarding wizard, branding |
| 2026-09-24 | e4f9557 | **Bug:** live timer froze when a 2nd member joined. **Root cause:** not the members. Safari's Userscripts extension had been *denied* access to tracketv1.vercel.app, and blocked requests fail silently. Fix: unique per-member script identity, visible failure badge, clearer dashboard message, "Always Allow" in setup steps |
| 2026-09-24 | 747d5c7 | Day health messages. **Bug:** date picker dead in Brave/Chrome (Chromium only opens a date input from its hidden calendar icon) → `showPicker()` on click |
| 2026-09-24 | 5e7bf46 | Work shift, pace score, duration-driven reminders |
| 2026-09-24 | 9a7e8c1 | Flag tickets that may not be yours (assignee / Task Status) |
| 2026-09-24 | 618b632 | Server-side alerts engine, Web Push (phone lock screen + watch, Home Screen app), auto mode (7h cap, lunch stop/restart, 25s countdown + Deny), lunch on the day bar + Remove lunch, 💬 missing-comment check, daily email report, change email, Mac menu bar (SwiftBar), scheduler URL in admin, userscript v2.3 |
| 2026-09-24 | (see git log) | Free-tier pass: Turso store with auto-copy from Upstash, batched reads, adaptive polling, one heartbeat tab (userscript v2.4), Gmail SMTP email, streamable menu bar with seconds, `/guide` for members, grammar-tidied messages (f7db29a) |

## Known limits / open ideas

- Verified live 2026-09-24: Web Push to Safari on the owner's Mac accepted by Apple (201); comment check matches Asana (no comments that day); owner's installed userscript updated to v2.3 in place (Asana tabs need a reload).
- **Live since 2026-09-24 (05939df):** Turso in Mumbai (aws-ap-south-1, 53 keys copied from Upstash), functions in Mumbai (`regions: ["bom1"]` in vercel.json), Gmail sending (test report delivered to the provider), Telegram removed (code + env vars), owner's userscript v2.4 + menu bar v2.1 installed. Warm poll ≈ 80–220 ms from India. Upstash database deleted by the owner (2026-09-24); its env vars are gone. The copy step now never overwrites Turso once it has members, and a failed copy only logs.
- **Incident 2026-09-24:** Vercel's Turso connection had *Create Database Branch For Deployment* ON for Production, so every deploy got a fresh empty DB branch. Fixed (setting OFF); data restored from branch `dpl-32yz7zkxj…` via the one-time `TRACKET_IMPORT_FROM`/`TRACKET_IMPORT_TOKEN` import (54 rows, 2 members); both env vars removed afterwards. Old branch DBs remain in Turso Cloud (free, can be deleted).
- **QStash:** EU region schedule `*/10 * * * *` POST → `/api/cron?key=…` (created 2026-09-24).
- No overnight shifts. Lunch is one window for every day.
- Auto mode relies on Asana's button labels ("Start timer" / "Stop timer"); if Asana renames them, actions fail visibly (alert).
- Past-day ⚠ chips show a ticket's *current* assignee/status, not what it was that day.
- Service workers don't register in the Claude built-in browser (embedded); test push in real Safari/Chrome.
- Always-on-screen widget ideas, to do later (owner asked to remember): (a) video picture-in-picture trick — draw the timer on a
  canvas, stream it into a `<video>` and pop it out; floats over every app in Safari and Chrome, rectangle only; (b) Chrome/Brave
  Document Picture-in-Picture — any HTML, always on top, not Safari; (c) small native macOS app — a round, draggable, always-on-top
  bubble on every Space, reading `/api/bar` with the member key; (d) iPhone: a Scriptable widget, or Live Activities (needs a native app).

## Debugging checklist

1. `curl https://tracketv1.vercel.app/api/health`: env present, DB ok, deployed commit.
2. Live timer frozen? Compare `lastHeartbeat` from `/api/live` with now. If it's stale while the Asana tab's
   `data-tracket-timer-alive` attribute is fresh, the sender is blocked: check the userscript manager's site permission
   for tracketv1.vercel.app (Safari: Userscripts icon → Always Allow). The Asana tab's console shows `[Tracket]` logs.
3. Owner's Mac: Safari has "Allow JavaScript from Apple Events" on, so `osascript ... do JavaScript` can read the
   logged-in Tracket/Asana tabs for diagnosis. The Userscripts scripts live in
   `~/Library/Containers/com.userscripts.macos.Userscripts-Extension/Data/Documents/scripts/`.
4. Local run: `SESSION_SECRET=<16+ chars> PORT=3111 node server.js` (uses `./data/store.json`; visitors get demo mode).
