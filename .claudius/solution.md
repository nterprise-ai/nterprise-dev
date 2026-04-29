# Technical Architecture

Single-package TypeScript library + CLI. Compiles with `tsc --build` to `dist/`. Ships both `src/` and `dist/` to GitHub Packages so consumers can resolve TS sources when they need to.

Module layout:
- `src/index.ts` — top-level public API (re-exports the portfree-equivalent surface)
- `src/cli.ts` — subcommand-first CLI parser (`nterprise dev | repos | doctor | uninstall | help`)
- `src/dev-server.ts`, `src/doctor.ts`, etc. — per-repo dev orchestration
- `src/repos/` — multi-repo orchestrator (`registry.ts`, `orchestrate.ts`)
- `src/themes/` — OKLCH color engine (sub-export `@nterprise-ai/dev/themes`)
- `src/website-builder/` — React iframe preview helpers (sub-export `@nterprise-ai/dev/website-builder`)

LaunchDaemon: `dev.nterprise.pfctl` (renamed from `dev.portfree.pfctl`). `nterprise doctor --fix` migrates the old daemon transparently.

Cross-repo state: `~/.config/nterprise/repos.json` registry, `~/.config/nterprise/state/<name>.{pid,log}` runtime files.
