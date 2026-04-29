# nterprise-dev

`@nterprise-ai/dev` — the dev-tooling package for the nterprise stack.

Provides:

- `nterprise` CLI — per-repo dev-server orchestration, multi-repo orchestration (`nterprise repos`), LaunchDaemon supervision, certificate management.
- Library exports — `themes` (OKLCH color engine), `website-builder` (React preview layer), tenant helpers, portless wrappers.

Lifted from the retiring `@sharadkumar/web@0.10.x` (which stays published frozen for legacy consumers). See `/Users/sharad/.claude/plans/also-bun-install-g-robust-pascal.md` for the migration plan.

## Install

```sh
bun install -g @nterprise-ai/dev
nterprise doctor --fix         # one-time LaunchDaemon migration
```

## Usage

```sh
nterprise                              # start dev stack (cwd)
nterprise dev [up|down|clean|list]     # per-repo dev orchestration
nterprise repos [up|down|status|...]   # multi-repo orchestration
nterprise doctor [--fix]               # diagnose / install LaunchDaemon
nterprise uninstall                    # remove LaunchDaemon + anchor
nterprise --help                       # full help
```

Per-repo dev config lives at `package.json#nterprise` (legacy keys `#portfree`, `#portless` are also accepted):

```json
{
  "nterprise": {
    "projectName": "my-project",
    "apps": ["web", "api"],
    "tld": "dev.example.com",
    "https": true
  }
}
```

Multi-repo registry: `~/.config/nterprise/repos.json`. Per-repo state: `~/.config/nterprise/state/<name>.{pid,log}`.

## Registry / publishing

Published to GitHub Packages under the `nterprise-ai` org. Consumers need `~/.npmrc` with a token that has `read:packages` (publishers need `write:packages`):

```
//npm.pkg.github.com/:_authToken=<token>
```

The package's `publishConfig.registry` pins the publish target to GitHub Packages — no extra scope rules required.

## Sub-exports

- `@nterprise-ai/dev` — top-level: `createDevServer`, `createDevDown`, tenant helpers, portless helpers.
- `@nterprise-ai/dev/themes` — OKLCH color engine.
- `@nterprise-ai/dev/website-builder` — React iframe preview helpers.

## Development

```sh
bun install
bun run lint
bun run test
bun run build
```

## LaunchDaemon

Installs `dev.nterprise.pfctl` (renamed from `dev.portfree.pfctl`). `nterprise doctor --fix` migrates the old daemon transparently — one combined sudo prompt covers teardown of the old plist + anchor and install of the new ones.
