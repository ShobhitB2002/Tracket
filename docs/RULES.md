# Rules

1. One isolated change per `task/<type>-<short-name>` branch. Push runs `gate-fast` (pre-push hook).
2. `integration` gets merged task work. Push runs `gate-full` (clean tree, tests on an export of that exact commit).
3. Never commit directly to `main`. `main` is the live branch that Vercel deploys. Changing it is a release, owner decision.
4. No history rewrites, no force-push on shared branches.
5. No secrets in Git. `.env` files and key material stay out (the gate blocks them).
6. Do not change repository visibility. The GitHub repo is currently PUBLIC; the owner decides.
7. GitHub Actions stay disabled. Local gates are the checks. Do not re-enable.
8. Tests must pass before merge. Do not skip or weaken tests to get green.
9. Record notable changes in `docs/HISTORY.md` and project status in `PROGRESS.md`.
10. Delete nothing: move unwanted files to `D:\_quarantine\`.
