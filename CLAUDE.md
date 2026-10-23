# Tracket: working rules for AI workers

Read first: `docs/RULES.md` (rules), `docs/DEPLOYMENT.md` (gates and release), `docs/HISTORY.md` (what changed, when).
Project memory and feature detail: `PROGRESS.md`. User-facing overview: `README.md`.

- Live site: https://tracketv1.vercel.app, auto-deployed by Vercel from `production` (renamed from `main` 2026-10-23; owner sets Vercel's production branch).
- Branches: `production` (release, live via Vercel; renamed from `main` 2026-10-23), `integration`, `task/<type>-<name>`. See `docs/RULES.md`.
- Zero npm dependencies, no build step. Tests: `node --test test/*.test.js` (19 tests).
- Local checks: `tools/ci/gate-fast.ps1` (task push), `tools/ci/gate-full.ps1` (integration push). Hooks: `tools/ci/install-hooks.ps1`.
- Never commit `.env*` (except `.env.example`), keys, or tokens.
