<div align="center">

# ◔ Tracket

**A live, dark-mode dashboard for your Asana time tracking.**

Today's tickets, the timer that's running right now, and your total for the day —
ticking in real time, even in a background tab.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FShobhitB2002%2FTracket&project-name=tracket&repository-name=tracket&env=ASANA_PAT,TRACKET_SECRET&envDescription=ASANA_PAT%3A%20your%20Asana%20personal%20access%20token.%20TRACKET_SECRET%3A%20a%20password%20you%20choose%20(locks%20the%20dashboard).&envLink=https%3A%2F%2Fgithub.com%2FShobhitB2002%2FTracket%23setup)

</div>

---

## What it does

- **One number that matters** — total time logged today on a big rolling odometer, with an 8-hour day bar split by ticket.
- **On air** — the Asana timer you're running *right now*, ticking by the second, added to the total live.
- **Every ticket you touched today** — time, share of the day, and sessions, each linking back to Asana.
- **Any past day** — ‹ › or pick a date (keys: `←` `→`, `T` for today). Straight from Asana, nothing stored.
- **Tab title ticks too** — `07:08:09 · ● Fix login bug` while you're on other sites.
- **Always in sync, no refresh button** — starts/stops show up in ~1s; edits or deletions in Asana within ~20s. Survives the internet dropping and resyncs on its own.
- **Multiple Asana tabs? No confusion.** Asana's background tabs go stale; Tracket only trusts the newest start and the tab you're looking at, and double-checks every stop against Asana's API.

## How it works

```
 Asana tab (your browser)                     Tracket (Vercel or local)              Asana API
 ┌────────────────────────┐   running timer   ┌─────────────────────────┐   logged   ┌──────────┐
 │ userscript reads the   │ ────────────────▶ │ /api/event   (state)    │ ◀───────── │ time     │
 │ active timer: task id  │   (~1s latency)   │ /api/live    (polled)   │   entries  │ tracking │
 │ + exact start time     │                   │ /api/today   (any date) │            │ entries  │
 └────────────────────────┘                   └────────────▲────────────┘            └──────────┘
                                                           │ every 2s
                                                   ┌───────┴───────┐
                                                   │  dashboard    │
                                                   └───────────────┘
```

- **Finished time** comes from Asana's official API (`time_tracking_entries`) using your personal access token — on the server only, never in the browser.
- **The running timer** isn't in Asana's public API, so a small userscript reads it from your open Asana tab (Asana's own task id + exact start time, not the ticking label) and sends it to your Tracket.

## Setup

You need: an Asana plan with time tracking, a free [Vercel](https://vercel.com) account, and a browser userscript manager.

### 1 · Get an Asana token

Asana → your profile photo → **Settings** → **Apps** → **Manage Developer Apps** → **Create new token**. Copy it (it's shown once).

> Your token stays yours. It lives only in *your* Vercel project's environment variables — it's never in this repo, never in the browser, never shared.

### 2 · Deploy

1. Click **Deploy with Vercel** above.
2. Fill in the two variables:
   | Variable | What to put |
   |---|---|
   | `ASANA_PAT` | the token from step 1 |
   | `TRACKET_SECRET` | any long password you make up — it locks your dashboard |
3. After it deploys: project → **Storage** → **Create Database** → **Upstash for Redis** (free) → **Connect** to this project.
4. **Deployments** → ⋯ on the latest → **Redeploy** (so it picks up the database).

Open your `https://<your-project>.vercel.app`, enter your `TRACKET_SECRET`, and you should see today's logged time.

### 3 · Install the userscript (for the live timer)

1. Install a userscript manager:
   - **Safari (Mac):** [Userscripts](https://apps.apple.com/app/userscripts/id1463298887) (free) → Safari → Settings → Extensions → enable it → allow it on `app.asana.com`.
   - **Chrome / Edge / Firefox / Brave:** [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Create a new script and **replace everything** in the editor with [`tracket.user.js`](tracket.user.js) ([raw](https://raw.githubusercontent.com/ShobhitB2002/Tracket/main/tracket.user.js)).
   > Safari Userscripts: open the extension page → **+** → **New JS** → select all → paste → **Save**. Don't paste *inside* the template, or its header wins.
3. Edit the two lines at the top:
   ```js
   const TRACKET_URL = 'https://<your-project>.vercel.app';
   const TRACKET_KEY = '<your TRACKET_SECRET>';
   ```
4. Reload your Asana tab and start a timer. It appears on Tracket within a second, and the **Asana link** dot turns green.

## Run it locally instead

No Vercel, no database — state is kept in `./data`.

```bash
git clone https://github.com/ShobhitB2002/Tracket.git && cd Tracket
cp .env.example .env        # then put your token after ASANA_PAT=
npm start                   # → http://localhost:3000
```

Leave `TRACKET_URL` as `http://localhost:3000` and `TRACKET_KEY` empty in the userscript. `TRACKET_SECRET` is optional locally (the server only listens on 127.0.0.1).

## Project layout

```
api/            Vercel functions — thin wrappers
lib/core.js     Asana client, day summaries, running-timer rules
lib/store.js    Upstash Redis (hosted) or a JSON file (local)
lib/auth.js     TRACKET_SECRET → cookie for the dashboard, header for the userscript
public/         the dashboard (single HTML file, no build step)
server.js       local server using the same handlers
tracket.user.js the userscript
```

Zero npm dependencies. Node 18+.

## FAQ

**Is my data safe?** Your token and timer state live in your own Vercel project and your own Redis database. Everything is behind your `TRACKET_SECRET`. Tracket only *reads* from Asana.

**The live timer stopped showing.** The userscript reads Asana's page internals, so an Asana update can break it — the **Asana link** dot turns grey. Logged time keeps working regardless (it uses the official API). Open an issue.

**Times are in whole minutes?** Finished entries are, because that's how Asana stores them. The running timer is shown to the second.

**Wrong day / midnight issues?** Days are computed in your browser's time zone.

## License

[MIT](LICENSE) © Shobhit Bansal
