# Tracket restructure report, 2026-10-23

## Outcome
**Partial.** Backup, docs, local gates, `integration` branch, and GitHub Actions disable are done and verified. The `production` branch and the local deploy are NOT done: `main` is watched by Vercel (the live site auto-deploys from it), so renaming it would change the live deploy path. Owner decision needed (see Owner items).

## What Tracket is
Members-only Asana time-tracking dashboard. Node 18+, zero npm dependencies, no build step. Live at https://tracketv1.vercel.app, hosted on Vercel from `main`. Also ships a Tampermonkey userscript (`tracket.user.js`), a menu bar script, and a widget. Tests: `node --test test/*.test.js`.

## SHAs (Verified: `git rev-parse`, `git ls-remote`)
| Ref | SHA | Local = remote |
|---|---|---|
| `main` (live, unchanged) | `43844cf` | yes |
| `task/infra-local-ci` | `b89fbe2` | yes |
| `integration` | `c0d0d70` (merge commit) | yes |
| report commit | this commit (HEAD of `integration`) | see below |

## URL and visibility
- Remote: https://github.com/ShobhitB2002/Tracket
- **Visibility: PUBLIC.** Existing repo. Not changed (rule: do not change visibility). Verified: `gh api repos/ShobhitB2002/Tracket` returns `"visibility":"public"`. Owner should decide whether to make it private.

## Branches
- `main`: NOT renamed to `production`. Verified: Vercel bot deployments on `main` commits (`gh api repos/ShobhitB2002/Tracket/deployments`), and `PROGRESS.md` says "auto-deploys from `main`".
- `production`: NOT created. A second release branch would diverge from the branch Vercel deploys.
- `integration`: created from `main`, with the task branch merged (`--no-ff`). Pushed.
- `task/infra-local-ci`: pushed. Kept (its content is in `integration`; deletion is the owner's call).

## Gates (local)
| Gate | Result | Evidence |
|---|---|---|
| G1 `gate-fast` on push of `task/infra-local-ci` | PASS (`b89fbe2`) | pre-push hook; `D:\_ci-runs\Tracket\fast-latest.json` |
| G2 `gate-full` on push of `integration` | PASS (`c0d0d70`) | pre-push hook; `D:\_ci-runs\Tracket\full-latest.json`: syntax, no-secrets, docs, clean-tree, tests on git-archive export |
| Tests, working tree | PASS: 19/19 | `npm test` (Verified) |
| `npm run check` | FAIL on Windows (cmd cannot run its `for ... do` script). Not a regression. The gate does the same `node --check` directly. | Verified by run |
| G4 deploy | SKIPPED: no local deploy target. Vercel deploys `main`. | - |
| APK | N/A: not an Android app | - |

## GitHub Actions
- Disabled: `gh api -X PUT repos/ShobhitB2002/Tracket/actions/permissions -F enabled=false`. Verified: `enabled` = `false`.
- `.github/workflows/test.yml` kept in the repo (removing it is an owner decision).

## Backup
- Folder: `E:\ProjectBackups\2026-10-23\Tracket\` (75 files, matched to source by file list; excludes nothing because there were no dependency folders; `.git` included).
- Bundle: `E:\ProjectBackups\2026-10-23\Tracket-all-2026-10-23.bundle`, `git bundle create --all`, `git bundle verify` = okay. SHA-256 `9D51E70E1EF71BD2A750D0EAF44B100A8BCFCFF54E3CCC26E674C697490A6B50`.

## Tidy
Skipped. The code files sit at the repo root and are referenced by path: `vercel.json` (`includeFiles: tracket.*.js`, `api/router.js`), the Tampermonkey userscript, and the tests. Moving them is not low-risk. New files went under `docs/` and `tools/ci/` only.

## Docs
`CLAUDE.md`, `docs/RULES.md`, `docs/HISTORY.md`, `docs/DEPLOYMENT.md`. `PROGRESS.md` and `README.md` left as they were.

## Preservation
Working tree was clean before the work (`git status` empty). No files deleted. `.env` files: none tracked (`.env.example` only). Nothing moved to quarantine.

## Unverified
- Whether the Vercel preview deploy happens on each `integration` push (Vercel default; not checked in the Vercel dashboard). The deployments list shows only `main`-type production deploys from the bot.
- Live site health after this change: not checked. No code on `main` changed, so no live change was made.
- Hooks were tested only by the pushes above, not by a deliberately failing push.

## Owner items
1. Rename `main` to `production`? It would change Vercel's deploy branch. Needs a Vercel setting change too.
2. Repo visibility: public now. Make private?
3. Merge `integration` into `main` (release)? That would deploy live via Vercel. Not done.
4. Vercel preview deploys on non-main pushes: keep or turn off.
5. Remove `.github/workflows/test.yml`, or keep disabled.
6. Delete `task/infra-local-ci` after review.
