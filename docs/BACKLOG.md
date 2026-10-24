# Backlog

Open items only. Delete an item when it ships; git keeps the history. Owner decisions are listed last.

## Not built (owner's ideas)
- **Comment on a ticket from Tracket.** Makes the 💬 chip actionable. Today Tracket only reads stories.
- **Search any Asana task from ⌘K.** Asana task search is used only as a day-summary fallback.
- **Focus / Pomodoro mode.**
- **Passkeys or two-step login.**
- **Native macOS bubble:** a round, draggable, always-on-top timer on every Space, reading `/api/bar` with the member key.
- **Android widget.**

## Partial
- **Add or edit time entries from Tracket.** Only the lunch fix exists (`removeLunch` in `lib/core.js`).
- **Automatic seasonal theme.** Snow shows by itself Dec to Feb (`public/themes.js`), but the theme itself is never chosen automatically.

## Known limits
- **One lunch window for every day,** and no overnight shifts. Shifts are per weekday, local time.
- **Past-day ⚠ chips** show a ticket's current assignee and status, not what it was that day.
- **Auto mode depends on Asana's button labels** ("Start timer", "Stop timer"). Watch this when Asana changes its UI.

## Code cleanup (app change, its own task)
- **Remove the dead Upstash fallback** in `lib/store.js` (`redis`, `redisPipeline`, the one-time `migrate` copy, `hasRedis`) and the Upstash mention in `lib/routes.js`. The Upstash database is deleted and its env vars are gone.

## To verify on real devices
Built and checked locally, not yet exercised with the owner's accounts and devices (last noted 2026-09-25):
- Start, Stop and switch from the dashboard pressing Asana's buttons, and the instant relay. Needs "Always Allow" for Tracket in the Userscripts extension too.
- Auto-stop at the daily limit (the tab opens the ticket to reach Stop), and the failsafe.
- Pop-out mini timer: Document PiP in Chrome, Brave or Edge; video PiP in Safari. Blocked in the Claude built-in browser.
- Web Push and the service worker in real Safari and Chrome.
- Slack status with a real workspace token. Weekly and monthly emails. The phone widget. Timesheet with real data.
- Admin team board and hosting usage with real traffic (usage counts are approximate).

## Owner decisions
- Keep Vercel preview deployments on non-production pushes, or turn them off?
- Repository stays public (owner's choice, not changed here).
