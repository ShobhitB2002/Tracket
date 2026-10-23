# History

## 2026-10-23: local CI/CD and branch model
- Backup taken: `E:\ProjectBackups\2026-10-23\Tracket\` plus `E:\ProjectBackups\2026-10-23\Tracket-all-2026-10-23.bundle` (`git bundle --all`, verified).
- Added `docs/` (CLAUDE.md, RULES, HISTORY, DEPLOYMENT) and `tools/ci/` (local gates, pre-push hook).
- Created `integration` and disabled GitHub Actions (`.github/workflows/test.yml` kept, unused).
- `main` NOT renamed to `production`: Vercel auto-deploys from `main` (`docs/DEPLOYMENT.md`). Owner decision pending.
- Earlier project history: see `PROGRESS.md` and `git log`.
