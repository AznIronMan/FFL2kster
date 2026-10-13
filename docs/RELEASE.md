# Release checklist (private builds)

Targets: web (PWA), Windows 10/11, macOS, Linux (direction note E). No store submissions.

| Step | How | Status (v1.0.0) |
|---|---|---|
| Parity suites green with defaults | `npm test` (port), field sweeps `SWEEP=sw_`, battle sweeps `BSWEEP=bs_` (need the ROM and build/traces) | see PROGRESS (P6) |
| Python suite green | `python -m pytest` | see PROGRESS (P6) |
| Performance headroom | `BENCH=1 npx vitest run packages/parity/test/bench.test.ts` | see PROGRESS (P6) |
| Soak run (hours of game time) | `SOAK=10 npx vitest run packages/parity/test/soak.test.ts` | see PROGRESS (P6) |
| Browsers | Chromium (built-in pane), Firefox and WebKit (`build/pwtest/smoke.mjs`, Playwright) | see PROGRESS (P6) |
| No game content | web: `npm run check:no-content`; desktop bundles: `port/scripts/check-bundles.sh` (in CI) | CI |
| Notices | NOTICE.md, THIRD_PARTY.md, About panel | done |
| Version | pyproject.toml (single source; the app reads it at build time), README, AGENTS, Tauri/Capacitor configs | |
| Tag and draft release | `git tag vX.Y.Z && git push origin vX.Y.Z` → release.yml drafts the release with web/Windows/macOS/Linux builds | |
| Smoke-test the draft's builds on each target | install per docs/INSTALL.md; import ROM, Continue a save, play a battle, export a save | owner |
| Publish or keep as draft | GitHub → Releases (publishing makes the files public in a public repository) | owner |
