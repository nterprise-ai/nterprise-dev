# nterprise-dev

`@nterprise-ai/dev` — the dev-tooling package for the nterprise stack.

Provides:

- `nterprise` CLI — per-repo dev-server orchestration, multi-repo orchestration (`nterprise repos`), LaunchDaemon supervision, certificate management.
- `appdev` CLI — legacy precursor, retained for back-compat.
- Library exports — `themes` (OKLCH color engine), `website-builder` (React preview layer), tenant helpers.

## Status

Bootstrap. Code is being lifted from `@sharadkumar/web@0.10.3` (which retires once consumers migrate). See `/Users/sharad/.claude/plans/also-bun-install-g-robust-pascal.md` for the migration plan.

## Install

```sh
# Once published:
bun install -g @nterprise-ai/dev
nterprise doctor --fix         # one-time LaunchDaemon migration
```

## Registry

Published to GitHub Packages under the `nterprise-ai` org. Requires `~/.npmrc` with a token that has `read:packages` (consumers) or `write:packages` (publishers) scope.
