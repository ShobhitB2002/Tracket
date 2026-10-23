# Deployment and local gates

Model: `D:\ForgeLoop\GENERAL_MODEL_2026-10-21.md`.

## Hosting (verified)
- Live site https://tracketv1.vercel.app is hosted on Vercel and deploys automatically from `production` (renamed from `main` 2026-10-23; owner sets Vercel's production branch) (Vercel bot deployments on GitHub commits, `gh api repos/ShobhitB2002/Tracket/deployments`).
- Pushing any other branch (e.g. `integration`, `task/*`) may create a Vercel PREVIEW deployment. Owner should confirm this is wanted.
- There is no local deploy target. The local deploy model does not apply yet.

## Branches
| Branch | Role | Local gate on push |
|---|---|---|
| `production` | live (Vercel), release branch | none; a release is a merge into `production`, owner go-ahead only |
| `integration` | combined task work | `gate-full` |
| `task/*` | one change each | `gate-fast` |
| `main` | renamed to `production` on 2026-10-23 (owner approved). Old name, do not use | - |

## Gates
| Gate | Trigger | Checks |
|---|---|---|
| G1 `gate-fast` | push of `task/*` (pre-push hook) | `node --check` on every tracked .js, JSON parse, PowerShell parse, no secret-like tracked files, docs present |
| G2 `gate-full` | push of `integration` | G1 plus clean working tree, and `node --test` on a `git archive` export of exactly that commit |
| G4 deploy | none | SKIPPED: no local target; Vercel deploys `production` |

Results: `D:\_ci-runs\Tracket\<gate>-latest.json` and a folder per run.
Run by hand: `powershell -ExecutionPolicy Bypass -File tools\ci\gate-fast.ps1` (or `gate-full.ps1`).
Install hooks: `powershell -ExecutionPolicy Bypass -File tools\ci\install-hooks.ps1`. There is no bypass.

## Known limitation
`npm run check` fails on Windows (its `for ... do` script needs sh). The gate performs the same `node --check` checks itself.
