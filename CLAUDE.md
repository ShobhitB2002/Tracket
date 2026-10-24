# Tracket: AI worker entry

Members-only Asana time-tracking dashboard. Live: https://tracketv1.vercel.app (Vercel deploys `production`).
Read first: this file, then `docs/DEPLOYMENT.md` (gates, release). Open items: `docs/BACKLOG.md`. Why things are the way they are: `docs/DECISIONS.md`. User overview: `README.md`.

## Rules
- One isolated change per `task/<type>-<short-name>` branch. Merge it into `integration`; a release is a merge into `production`.
- `production` is live (Vercel). Never commit to it directly. Changing it is a release: owner go-ahead only.
- Pushing `integration` or `task/*` may create a Vercel PREVIEW deployment.
- GitHub Actions stay disabled. Local gates are the checks. Do not re-enable them.
- No `--no-verify`, no force-push, no history rewrites on shared branches.
- Tests must pass before merge. Never skip or weaken tests.
- No secrets in Git: `.env*` (except `.env.example`), keys, tokens. The Asana token is never logged or committed.
- Do not change repository visibility (the repo is public; owner decides).
- Delete nothing: move unwanted files to `D:\_quarantine\<date>-tracket\` with a `MANIFEST.csv` (path, size, sha256).
- Update `docs/BACKLOG.md` when an item changes. Add a `docs/DECISIONS.md` line only for a non-obvious decision or a trap.
- Keep these docs free of version numbers, test counts and dates of status. Git has those.

## Commands
- Tests: `node --test test/*.test.js` (zero npm deps, Node 18+). One file: `node --test test/core.test.js`.
- Fast gate (G1, also pre-push on `task/*`): `powershell -ExecutionPolicy Bypass -File tools\ci\gate-fast.ps1`
- Full gate (G2, also pre-push on `integration` and `production`): `powershell -ExecutionPolicy Bypass -File tools\ci\gate-full.ps1` (needs a clean tree; tests run on an export of HEAD).
- Install hooks: `powershell -ExecutionPolicy Bypass -File tools\ci\install-hooks.ps1`
- Local server: `SESSION_SECRET=<16+ chars> PORT=3111 node server.js` (file store at `./data/store.json`).
- `npm run check` fails on Windows (its `for` loop needs sh). The gate runs the same checks.

## Code map
- `api/router.js`: the one Vercel function for all `/api/*` (routes in `vercel.json`).
- `server.js`: local server on the same routes.
- `lib/routes.js`: route table (public, member, admin); generates the userscript, menu bar plugin and widget.
- `lib/core.js`: Asana client, day summaries, running-timer rules. Its only Asana write is the lunch fix (`removeLunch`).
- `lib/alerts.js`: reminders, alert feed, auto mode, Start/Stop commands.
- `lib/users.js`, `lib/crypto.js`: members, sessions, keys, rate limits; scrypt, HMAC, AES-256-GCM.
- `lib/store.js`: Turso in production, JSON file locally (Upstash path is legacy, see BACKLOG).
- `lib/notify.js`, `lib/push.js`, `lib/report.js`, `lib/slack.js`, `lib/leave.js`, `lib/prefs.js`, `lib/usage.js`, `lib/apipath.js`.
- `public/`: dashboard `index.html`, `admin.html`, `guide.html`, `timesheet.html`, themes (`themes.js/.css`), service worker `sw.js`.
- `tracket.user.js` (Asana userscript), `tracket.menubar.js` (SwiftBar), `tracket.widget.js` (phone widget).
- `test/`: node:test suites. Each sets its own store through `TRACKET_DATA_FILE`.
- `tools/ci/`: local gates, hooks, `ci.config.json` (required docs list).

## Live-state safety
- Never run tests or scripts against the live database. Tests use a file store.
- Never print Vercel env values. Env var names are in `docs/DECISIONS.md`.

## Known traps
- Asana's "Start timer" / "Stop timer" button labels are external. If Asana renames them, auto mode fails visibly.
- Changing `SESSION_SECRET` logs everyone out and resets push keys and the cron URL.
- Service workers do not register in the Claude built-in browser. Test Web Push in real Safari or Chrome.
- Userscript changes do not reach members until they reinstall. The dashboard warns when an old copy reports.
