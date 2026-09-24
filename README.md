<div align="center">

# ◔ Tracket

**A live, dark-mode dashboard for your Asana time tracking.**

Today's tickets, the timer that's running right now, and your total for the day —
ticking in real time, even in a background tab.

**Members-only** · [Try the demo & request access →](https://tracketv1.vercel.app)

</div>

---

## What it does

- **One number that matters** — total time logged today on a big rolling odometer, with an 8-hour day bar split by ticket.
- **On air** — the Asana timer you're running *right now*, ticking by the second and added to the total live.
- **Your shift, live** — set your working days and hours; see time left, a pace score (100 = on track for the 7h minimum) and where you'll land by shift end.
- **Reminders that follow your hours** — a notification the moment you pass 7h and 8h; under 7h, a nudge if you stop a timer in your shift's last 30 minutes and again when the shift ends.
- **Notifications everywhere** — reminders are decided on the server, so they reach your phone's lock screen (and your watch) even with Tracket closed. On iPhone, add Tracket to your Home Screen first.
- **Auto mode** — stop your timer at a daily limit (default 7h), and stop it for lunch and restart the same ticket after. Every auto action shows a 25-second countdown with a **Deny** button, in your Asana tab and on Tracket.
- **Lunch, made visible** — lunch shows on your day bar; time logged during lunch is flagged with a **Remove lunch** button that fixes the entry in Asana.
- **“Dude, you forgot to mention what you did on this ticket. All good?”** — tickets you logged time on but didn't comment on that day get flagged, on every timer stop and at shift end.
- **Daily email report** — your total, tickets, anything worth a look and every reminder of the day.
- **Mac menu bar** — the running timer, today's total and a 🔔 for new alerts, via SwiftBar.
- **“Is this really your ticket?”** — tickets not assigned to you, or whose Task Status isn't *In Grooming* / *In Development*, get a ⚠ with the reason, and every timer start on one sends an alert.
- **Every ticket you touched today** — time, share of the day and sessions, each linking back to Asana.
- **Any past day** — ‹ › or pick a date (`←` `→`, `T` for today), straight from Asana.
- **The tab title ticks too** — `07:08:09 · ● Fix login bug` while you're on other sites.
- **Always in sync, no refresh button** — starts and stops show up in about a second; edits and deletions in Asana within ~20s. Survives the internet dropping and resyncs on its own.
- **Several Asana tabs open? No confusion.** Asana's background tabs go stale; Tracket only trusts the newest start and the tab you're looking at, and double-checks every stop against Asana's API.

## Access

**New member? Follow the [step-by-step guide](https://tracketv1.vercel.app/guide)** — setup, phone notifications, auto mode, menu bar.

Tracket is invite-only. Open the site to explore a live demo, then hit **Request access**. Once approved you get a login by email:

1. **Log in** with the email and password you were sent.
2. **Connect Asana** — paste a personal access token ([Asana → Developer console](https://app.asana.com/0/my-apps) → *Create new token*). It's encrypted before it's stored and used to read your time; the only thing it ever changes is lunch time you ask it to remove.
3. **Install the live-timer userscript** — Settings → *Copy my userscript*. Your copy is pre-configured for your account.
   - **Safari:** [Userscripts](https://apps.apple.com/app/userscripts/id1463298887) → enable in Safari → Settings → Extensions, allow on `app.asana.com` → extension page → **+ → New JS** → select all → paste → Save.
     Then choose **Always Allow** when Safari asks about the Tracket site. Denying it (or "Allow for One Day") silently stops the live timer.
   - **Chrome / Edge / Firefox:** [Tampermonkey](https://www.tampermonkey.net/) → *Create a new script* → select all → paste → Save.
4. Reload your Asana tab and start a timer — it appears on Tracket within a second.

Each member's script has their name in it (`Tracket · <name>`), so two accounts' scripts in one browser don't overwrite each other. If the script can't reach Tracket, a small warning appears in the corner of your Asana tab.

## How it works

```
 Your Asana tab                               Tracket                                   Asana API
 ┌────────────────────────┐  running timer   ┌──────────────────────────────┐  logged   ┌──────────┐
 │ userscript reads the   │ ───────────────▶ │ per-member state (Redis)     │ ◀──────── │ time     │
 │ active timer: task id  │  (~1s, your key) │ Asana token: AES-256-GCM     │  entries  │ tracking │
 │ + exact start time     │                  │ sessions: signed cookies     │           │ entries  │
 └────────────────────────┘                  └──────────────▲───────────────┘           └──────────┘
                                                            │ every 2s
                                                    ┌───────┴───────┐
                                                    │   dashboard   │
                                                    └───────────────┘
```

- **Logged time** comes from Asana's official API (`time_tracking_entries`), server-side only.
- **The running timer** isn't in Asana's public API, so a small userscript reads it from your open Asana tab — Asana's own task id and exact start time, not the ticking label.
- **Stale tabs can't lie:** a newer start always wins, "stopped" is only accepted from the tab you're looking at, and a stop becomes final only once Asana has logged the entry.

### Security & privacy

- Each member's data is isolated (`u:<id>:*` keys). Nobody — including the admin — can see another member's Asana data.
- Asana tokens are encrypted at rest with AES-256-GCM; passwords are hashed with scrypt; sessions are HMAC-signed, HttpOnly cookies.
- The userscript authenticates with a per-member key that can be rotated from Settings.
- Login, admin and request endpoints are rate-limited; the request form has a bot honeypot.
- Tracket only ever **reads** from Asana.

## Under the hood

Zero npm dependencies, no build step, Node 18+.

```
api/router.js     one Vercel function for every /api/* route
lib/routes.js     route table: public · member · admin
lib/core.js       Asana client, day summaries, running-timer rules
lib/users.js      members, access requests, sessions, API keys, rate limits
lib/crypto.js     scrypt, HMAC sessions, AES-256-GCM
lib/notify.js     access-request pings (email via Resend, Telegram)
lib/store.js      Turso or Upstash Redis (hosted), or a JSON file (local)
public/           dashboard + admin panel — plain HTML/CSS/JS
server.js         local server using the same routes
tracket.user.js   the userscript
PROGRESS.md       project notes, history and open items (for contributors)
```

## License

**Source-available, not open source.** You're welcome to read the code and learn from it; using, hosting or redistributing it needs permission. See [LICENSE](LICENSE).

© 2026 Shobhit Bansal
