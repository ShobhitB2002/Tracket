# Decisions

One entry per non-obvious decision or trap: date, what, why. Newest first within a section. Git has the rest.

## Release and gates
- 2026-10-24: Docs cut to five files (`CLAUDE.md`, `README.md`, `docs/DEPLOYMENT.md`, `docs/BACKLOG.md`, `docs/DECISIONS.md`). Old rules, history and progress notes moved to `D:\_quarantine\2026-10-24-tracket\`. Why: one place per kind of fact.
- 2026-10-24: GitHub Actions workflow moved to quarantine. Why: Actions are disabled by owner decision; local gates replace them.
- 2026-10-23: `main` renamed to `production` (same SHA). Vercel deploys `production`. Owner approved.
- 2026-10-23: No local deploy target. Vercel deploys from `production`, so the local gate is the only check before a release.
- 2026-10-23: Pre-push hooks run the gates and block the push on failure. There is no bypass. Why: the gates are the only checks now.
- Pushing `integration` or `task/*` can create Vercel preview deployments. Accepted; owner to confirm (see BACKLOG).

## Architecture
- Logged time comes from Asana's API, server side only, refreshed at most every 20s per member.
- The running timer is not in Asana's public API. `tracket.user.js` reads Asana's React `activeTimer` (task id and exact start time) from the page and posts it to `/api/event`. One leader tab sends a 60s heartbeat. Other tabs report starts and stops at once.
- Stale tabs: a newer start always wins. "Stopped" is accepted only from the visible tab. A stop becomes final once Asana logs the entry, or after 25s.
- Alerts are decided on the server (`lib/alerts.js`, `evaluate()`), so they work with no tab open. Triggers: heartbeats, dashboard polls, menu bar, `/api/cron`. Each alert key fires once per day.
- Auto mode runs on heartbeats only. Only an open Asana tab can press Asana's buttons. With no Asana tab open, nothing happens. Owner's call: no other fallback, because editing time on our own is risky.
- Auto-mode flow: offer, 25s countdown, then one claim (`lock:autoclaim:<id>`), a Deny, or timeout. A claim with no result within 90s counts as failed.
- Asana's Stop button exists only in the ticket's pane. The corner popout has none, so the tab opens the ticket, stops, and returns. Plain click first; pointer events only if Asana ignores the click, never both (a double toggle).
- Lunch minutes are computed only for entries from a timer Tracket saw start (within ±3 min). Manual entries are never treated as lunch.
- "Is this your ticket?" checks the assignee, the custom field "Task Status" and the board section. Subtasks with no section skip the section check. The parent is ignored on purpose (it is often a sprint container).
- Comment check: a comment counts when it was added by you that day, in your timezone.
- Isolation: every member key is `u:<id>:*`. Global keys: `members`, `apikeys`, `requests`, `rl:*`, `vapid`.
- Web Push has no npm deps: VAPID ES256 JWT and aes128gcm (RFC 8291), in `lib/push.js`.
- Email: Gmail SMTP when configured, Resend as fallback.
- Themes: no official character names or logos (trademarks). Batman- and Ben 10-inspired themes use original names and art.
- Start/Stop from Tracket: a manual Start outside the shift is refused (failsafe). Manual actions have no countdown and no Deny.

## Free-tier budget (target: up to about 10 members, all free)
- Watched limits: Vercel Hobby (1M function calls, 4h active CPU, non-commercial only), Turso (500M row reads, 10M writes), QStash (1,000 messages a day), Gmail (about 500 emails a day). Admin panel shows usage.
- 2026-09-24: Upstash (old) ran about 31,200 Redis commands an hour and exhausted the 500K monthly quota in about two workdays for one member. Turso measured about 780 row writes and 5,900 row reads an hour.
- Rules that keep it there: dashboard polls every 4s focused, 12s visible, 90s hidden. Asana refresh every 30s (90s in background). One heartbeat tab. One `mget` per request. Skip no-op state writes. In-memory throttles before any lock write.

## Env var names (Vercel). Values never go in docs or git
- Production: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`.
- Production and Preview: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET` (16+ characters).
- Optional: `CRON_SECRET` (Bearer token for a scheduler), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (generated and stored if absent), `RESEND_API_KEY`, `RESEND_FROM` (email fallback).
- Removed: `KV_REST_API_URL`, `KV_REST_API_TOKEN` (Upstash), `TRACKET_IMPORT_FROM`, `TRACKET_IMPORT_TOKEN` (one-time import). Code still reads the Upstash names (see BACKLOG).
- Trap: changing `SESSION_SECRET` logs everyone out and resets the push keys and the cron URL.
- Trap, 2026-09-24: the Turso integration's "Create Database Branch For Deployment" must be OFF for Production. ON gave every deploy an empty database.

## History, short
- 2026-09-23: first version, then members-only with admin panel and access requests.
- 2026-09-24: a live-timer freeze for a second member was not the code. Safari's userscript extension had been denied access to the site. Fix: per-member script identity, a visible failure badge, "Always Allow" in the setup steps.
- 2026-09-24: Telegram removed. Upstash database deleted by the owner. Turso in Mumbai with functions in `bom1`.
- 2026-09-25: a 7h auto-stop failed ("No Asana tab answered in time"). Causes: the offer reached only one tab; the Stop button is in the ticket pane only; Safari froze background tabs. Fix: share offers across tabs, open the ticket to stop, longer patience.
- 2026-10-23: local gates, `integration` branch and Actions disabled; `main` renamed to `production`. Backup: a folder copy plus a `git bundle --all`, verified.
