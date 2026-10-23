# Tracket: working rules for AI workers

Read first: `docs/RULES.md` (rules), `docs/DEPLOYMENT.md` (gates and release), `docs/HISTORY.md` (what changed, when).
Project memory and feature detail: `PROGRESS.md`. User-facing overview: `README.md`.

- Live site: https://tracketv1.vercel.app, auto-deployed by Vercel from `main`.
- Branches: `main` (live, Vercel-watched), `integration`, `task/<type>-<name>`. See `docs/RULES.md`.
- Zero npm dependencies, no build step. Tests: `node --test test/*.test.js` (19 tests).
- Local checks: `tools/ci/gate-fast.ps1` (task push), `tools/ci/gate-full.ps1` (integration push). Hooks: `tools/ci/install-hooks.ps1`.
- Never commit `.env*` (except `.env.example`), keys, or tokens.
