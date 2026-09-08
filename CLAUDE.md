# nterprise-dev

`@nterprise-ai/dev` — single-package TypeScript library + CLI. Compiles with `tsc --build` to `dist/`.

## Stack

- Bun (>=1.0)
- TypeScript (`tsc --build`)
- Biome (lint + format)
- Tests: `bun test` (Bun's built-in runner)
- Published to GitHub Packages under `nterprise-ai` org

## Layout

- `src/index.ts` — top-level public API
- `src/cli.ts` — `nterprise` bin entry, subcommand dispatcher
- `src/dev-cli.ts` — `nterprise dev …` handler (per-repo)
- `src/repos/` — `nterprise repos …` handler (multi-repo)
- `src/doctor.ts` — diagnostics + LaunchDaemon install + migration
- `src/themes/` — OKLCH color engine (sub-export)
- `src/website-builder/` — React iframe helpers (sub-export)

## Commands

```sh
bun install
bun run lint           # biome check .
bun run lint:fix       # biome check --write .
bun run test           # bun test
bun run build          # tsc --build → dist/
```

## Publishing

Tag `v*` on `main` and the `publish.yml` GH Action runs `bun publish` against GitHub Packages.

## LaunchDaemon

Owns `/Library/LaunchDaemons/dev.nterprise.pfctl.plist` + `/etc/pf.anchors/dev.nterprise.pfctl`. `nterprise doctor --fix` installs both; if a legacy `dev.portfree.pfctl` is present, the same fix path bootouts it and removes its plist + anchor first (one sudo prompt).

## Repos registry

`~/.config/nterprise/repos.json` — list of `{name, path}`. Runtime state per repo: `~/.config/nterprise/state/<name>.{pid,log}`.
