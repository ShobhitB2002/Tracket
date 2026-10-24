<div align="center">

# ◔ Tracket

**A live, dark-mode dashboard for your Asana time tracking.**

Today's tickets, the timer that's running right now, and your total for the day,
ticking in real time, even in a background tab.

**Members-only** · [Try the demo & request access →](https://tracketv1.vercel.app)

</div>

---

## What it does

- **Today's total** on a rolling odometer, with an 8-hour day bar split by ticket. Any past day too (`←` `→`, `T`).
- **On air:** the Asana timer you're running now, ticking by the second, also in the tab title.
- **Work shift:** time left, a pace score and your projected total. Leave and holidays switch off that day's reminders and reports, and don't break streaks.
- **Reminders** at 7h and 8h, plus nudges and a failsafe. Sent by Web Push to phone lock screens and watches, decided on the server.
- **Auto mode:** stop at a daily limit, stop for lunch and restart the same ticket. Every action has a 25-second countdown with **Deny**.
- **Lunch:** shown on the day bar. **Remove lunch** fixes an entry in Asana.
- **Start / stop from Tracket:** the hero button, a ▶ on each ticket, ⌘K, or `S`.
- **Checks:** 💬 when you logged time on a ticket without a comment that day; ⚠ when a ticket may not be yours.
- **Reports:** daily, weekly and monthly email. Timesheet export (CSV or JSON, print to PDF).
- **Slack status** while a timer runs (opt-in, your own Slack token).
- **History:** 14 days, weeks and months, with insights (estimate vs actual per project and tag).
- **Themes:** about 20, including a light and dark pair and a "match device" option.
- **Pop-out mini timer** (Chromium Document Picture-in-Picture; video picture-in-picture in Safari).
- **Team board** (admin view, members who opt in: status and totals only).
- **Mac menu bar** (SwiftBar) and **phone widget** (Scriptable).
- **In sync:** starts and stops show in about a second, edits in Asana within about 20 seconds. Several Asana tabs are handled: only the newest start and the visible tab are trusted.

## Access

**New member? Follow the [step-by-step guide](https://tracketv1.vercel.app/guide).**

Tracket is invite-only. Open the site to see the demo, then **Request access**. Once approved:

1. Log in with the email and password you were sent.
2. Connect Asana: paste a personal access token (Asana → Developer console → *Create new token*). It is encrypted before storage.
3. Install the live-timer userscript: Settings → *Copy my userscript*, then paste it into Userscripts (Safari) or Tampermonkey (Chrome, Edge, Firefox). In Safari choose **Always Allow** for Tracket; denying it silently stops the live timer.
4. Reload your Asana tab and start a timer. It appears on Tracket within a second.

## How it works

- **Logged time** comes from Asana's API (`time_tracking_entries`), server side only.
- **The running timer** is not in Asana's public API. A small userscript reads Asana's own task id and start time from your open Asana tab.
- **Stale tabs cannot lie:** a newer start wins, and "stopped" is only accepted from the visible tab.

### Security and privacy

- Each member's data is isolated. Nobody, including the admin, can see another member's Asana data.
- Asana tokens are encrypted at rest (AES-256-GCM). Passwords are hashed with scrypt. Sessions are HMAC-signed HttpOnly cookies.
- The userscript uses a per-member key that can be rotated from Settings.
- Login, admin and request endpoints are rate-limited. The request form has a bot honeypot.
- Tracket reads your time from Asana. It writes only when you click **Remove lunch**, and when auto mode or Start/Stop presses Asana's own timer buttons in your open Asana tab.

## Under the hood

Zero npm dependencies, no build step, Node 18+. Hosted on Vercel with Turso. Local development uses a JSON file.

```
api/router.js       one Vercel function for every /api/* route
server.js           local server on the same routes
lib/                routes, Asana core, alerts, users, crypto, store, push, email,
                    reports, leave, Slack, prefs, usage (one module each)
public/             dashboard, admin, guide, timesheet pages; themes; service worker
tracket.user.js     Asana userscript (live timer, auto mode)
tracket.menubar.js  Mac menu bar plugin template
tracket.widget.js   phone widget template
test/               node:test suites (npm test)
tools/ci/           local gates and git hooks
docs/               DEPLOYMENT, BACKLOG, DECISIONS
CLAUDE.md           rules and commands for AI workers
```

Contributors: start with [CLAUDE.md](CLAUDE.md), then [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## License

**Source-available, not open source.** You're welcome to read the code and learn from it; using, hosting or redistributing it needs permission. See [LICENSE](LICENSE).

© 2026 Shobhit Bansal
