# Tracket: project notes & progress

The working memory for this project: what exists, why it's built that way, what's
been done, and what's open. Update it at the end of each piece of work.
(README.md is the user-facing overview. This file is for whoever works on it next.)

## At a glance

- **Live site:** https://tracketv1.vercel.app (Vercel, auto-deploys from `main`)
- **Repo:** https://github.com/ShobhitB2002/Tracket
- **Owner / admin:** Shobhit Bansal. Admin panel at `/admin` (password = `ADMIN_PASSWORD` env var)
- **Stack:** Node 18+, zero npm dependencies, no build step. Vercel function + Upstash Redis
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
- **Isolation:** every member key is `u:<id>:*`. Keys: `pat, me, state, hb, names, seen, shift, chk, day:<date>, tasks:<date>`.
  Global keys: `members, apikeys, requests, rl:*`.

### Files
| File | Role |
|---|---|
| `api/router.js` | the single Vercel function for all `/api/*` (vercel.json rewrites to `?__path=`) |
| `lib/routes.js` | route table (public / member / admin), per-member userscript generation, shift API |
| `lib/core.js` | Asana client, day summaries, running-timer rules, ticket ownership checks |
| `lib/users.js` | members, requests, sessions (HMAC cookies `tk_s` / `tk_a`), API keys, rate limits |
| `lib/store.js` | Upstash Redis REST, or a JSON file in `./data` locally |
| `lib/crypto.js`, `lib/notify.js` | scrypt/HMAC/AES; access-request pings (Resend email, Telegram) |
| `public/index.html` | the whole dashboard (plain HTML/CSS/JS) |
| `public/admin.html` | admin panel |
| `tracket.user.js` | the userscript template. `/api/userscript` fills in URL, key, @name, @namespace |

### Env vars (Vercel)
`ADMIN_PASSWORD`, `SESSION_SECRET` (16+ chars; changing it logs everyone out), `RESEND_API_KEY` + `ADMIN_EMAIL`,
optional Telegram. The Upstash integration sets `KV_REST_API_URL`/`KV_REST_API_TOKEN`. See `.env.example`.

## Features & rules (current)

- **Day health** (`public/index.html` → `VERDICTS`, `verdict()`): under 7h / 7h+ / 8h+ messages under the day bar.
  Today uses the owner's wording; past days get past-tense variants. There's a 7h marker on the tape.
- **Work shift** (`POST /api/shift`, stored at `u:<id>:shift` = `{days:{0-6:{start,end}}}`, 0 = Sunday, local time; no overnight):
  a shift card shows time left, a **pace score** (100 = on pace for 7h, computed as logged ÷ (7h × elapsed/shift length)), and the
  projected total. After the shift or on past days, the score is total ÷ 7h.
- **Reminders** (client side, need an open Tracket tab plus notification permission; `checkAlerts`, `onTimerStop`, `once()` keys in localStorage):
  - crossing 7h → one notification. Crossing 8h → one (jumping straight past 8h sends only the 8h one)
  - under 7h: a timer stop within the last 30 min of the shift → one. Shift end (within 5 min) → one. Uses the day's
    peak total, so the dip right after a stop can't false-fire
- **"Is this really your ticket?"** (`core.js` judge/checkTasks; cache `u:<id>:chk`, 30s):
  OK = assigned to me AND the custom field "Task Status" is "In Grooming" or "In Development". Otherwise a ⚠ chip
  appears on the row and On Air card, and an alert fires on **every** timer start (by design, the owner wants it repeated).
  No Task Status field → the assignee is still checked, and it's flagged "No Task Status field — are you sure that's acceptable?"
  Checks never throw (so there are no false warnings when Asana fails).
- **Userscript v2.2:** per-member `@name Tracket · <name>` / `@namespace tracket/<id>`. A warning pill shows in the Asana
  tab when sends error, time out, or get no answer in 20s. The dashboard says "Asana tab stopped reporting X ago" and gives the fix.

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

## Known limits / open ideas

- Reminders only fire while a Tracket tab is open. Server-side push/email (Resend is already set up) was offered, not built.
- No overnight shifts.
- Past-day ⚠ chips show a ticket's *current* assignee/status, not what it was that day.
- Upstash free tier is ~500K commands/month; one open dashboard uses roughly 3 commands/s. Watch this as members grow.
- A Tracket version check for outdated userscripts (diag sends `v`) isn't surfaced yet.

## Debugging checklist

1. `curl https://tracketv1.vercel.app/api/health`: env present, DB ok, deployed commit.
2. Live timer frozen? Compare `lastHeartbeat` from `/api/live` with now. If it's stale while the Asana tab's
   `data-tracket-timer-alive` attribute is fresh, the sender is blocked: check the userscript manager's site permission
   for tracketv1.vercel.app (Safari: Userscripts icon → Always Allow). The Asana tab's console shows `[Tracket]` logs.
3. Owner's Mac: Safari has "Allow JavaScript from Apple Events" on, so `osascript ... do JavaScript` can read the
   logged-in Tracket/Asana tabs for diagnosis. The Userscripts scripts live in
   `~/Library/Containers/com.userscripts.macos.Userscripts-Extension/Data/Documents/scripts/`.
4. Local run: `SESSION_SECRET=<16+ chars> PORT=3111 node server.js` (uses `./data/store.json`; visitors get demo mode).
