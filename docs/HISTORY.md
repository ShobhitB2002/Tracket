# History

## 2026-10-23: local CI/CD and branch model
- Backup taken: `E:\ProjectBackups\2026-10-23\Tracket\` plus `E:\ProjectBackups\2026-10-23\Tracket-all-2026-10-23.bundle` (`git bundle --all`, verified).
- Added `docs/` (CLAUDE.md, RULES, HISTORY, DEPLOYMENT) and `tools/ci/` (local gates, pre-push hook).
- Created `integration` and disabled GitHub Actions (`.github/workflows/test.yml` kept, unused).
- `main` NOT renamed to `production`: Vercel auto-deploys from `main` (`docs/DEPLOYMENT.md`). Owner decision pending.
- Earlier project history: see `PROGRESS.md` and `git log`.

## 2026-10-23: branch rename main -> production (owner approved)
- GitHub branch `main` renamed to `production`; default branch is now `production`. Local `main` renamed to `production`, tracking `origin/production`. Same SHA (`43844cf`). Nothing merged into `production`.
- Supersedes the earlier 'main NOT renamed' entry above. Owner sets Vercel's production branch to `production`.
- `docs/RULES.md`, `docs/DEPLOYMENT.md`, `CLAUDE.md`, `PROGRESS.md` now name `production` as the release branch.
