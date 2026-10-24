# Deployment and local gates

Model: `D:\ForgeLoop\GENERAL_MODEL_2026-10-21.md`.

## Hosting
- Live site https://tracketv1.vercel.app is hosted on Vercel and deploys automatically from `production`. There is no build step.
- Pushing `integration` or `task/*` may create a Vercel PREVIEW deployment.
- There is no local deploy target (gate G4 is SKIPPED).

## Branches
| Branch | Role | Local gate on push |
|---|---|---|
| `production` | live (Vercel), release branch | `gate-full`. A release is a merge into `production`; owner go-ahead only |
| `integration` | combined task work | `gate-full` |
| `task/*` | one change each | `gate-fast` |

A push is refused unless the pushed ref is the checked-out HEAD.

## Gates
| Gate | Trigger | Checks |
|---|---|---|
| G1 `gate-fast` | push of `task/*` (pre-push hook) | `node --check` on every tracked .js, JSON parse, PowerShell parse, no secret-like tracked files, required docs present |
| G2 `gate-full` | push of `integration` or `production` | G1 plus a clean working tree, and `node --test` on a `git archive` export of exactly that commit |
| G4 deploy | none | SKIPPED: no local target; Vercel deploys `production` |

Results: `D:\_ci-runs\Tracket\<gate>-latest.json` and a folder per run.
Run by hand: `powershell -ExecutionPolicy Bypass -File tools\ci\gate-fast.ps1` (or `gate-full.ps1`).
Install hooks: `powershell -ExecutionPolicy Bypass -File tools\ci\install-hooks.ps1`. There is no bypass.
Required docs are listed in `tools/ci/ci.config.json`. Update it when a required doc moves.

## Release
1. Commit on `task/<type>-<name>`. Push: G1 runs.
2. Merge into `integration`. Push: G2 runs.
3. Merge into `production`. Push: G2 runs again on that commit, then Vercel deploys it.
4. Verify the deployment: `gh api "repos/ShobhitB2002/Tracket/deployments?environment=Production&per_page=1"` (state `success`), and `curl https://tracketv1.vercel.app/api/health`.
5. Delete the task branch locally and on `origin` once its work is in `integration`.

Rollback: Vercel dashboard → Deployments → promote the previous good deployment. Or `git revert` on `production` (no history rewrite). Neither has been exercised yet.

## Scheduler and health
- Reminders, weekly and monthly reports run from `/api/cron?key=<cron key>` (the admin panel shows the URL). Upstash QStash calls it every 10 minutes. Without it, reminders still run whenever an Asana tab, the dashboard or the menu bar is open.
- `/api/health` reports env presence, database status and the deployed commit.

## Known limitation
`npm run check` fails on Windows (its `for ... do` script needs sh). The gate performs the same `node --check` checks itself.
