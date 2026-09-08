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
    "https": true,
    "tenants": {
      "app": "website",
      "tenantHostMode": "flat",
      "slugs": ["demo", "acme"]
    }
  }
}
```

With `tld` set, tenant Portless routes default to **`{slug}.{appName}.{tld}`** (nested under the chosen app). For wildcard-style tenant hosts **`{slug}.{tld}`** (e.g. `acme.dev.example.com`), set **`tenantHostMode`** to **`"flat"`**. Omit it or use **`"nested"`** for the legacy layout.

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

`nterprise doctor --fix` installs or upgrades `dev.nterprise.pfctl` with one
interactive sudo session. Existing boot-only installations are reported as
outdated even when their HTTPS path happens to work.

The root-owned helper in `/Library/PrivilegedHelperTools/dev.nterprise.pfctl`
runs at boot and every 30 seconds through native launchd `StartInterval`. It
restores the dedicated `dev.nterprise` PF anchor if its rule disappears and
re-enables PF if it is disabled. Healthy runs only read state. Recovery uses
system binaries and root-owned files; it needs neither Bun, a repository
checkout, a logged-in terminal, nor passwordless sudo. The rule only redirects
IPv4 loopback destination `127.0.0.1:443` to Portless on `:1355`.

Installation adds an anchor dispatcher and loader to `/etc/pf.conf`, validates
it, retains a timestamped `/etc/pf.conf.nterprise-backup-*`, and reloads that
configuration once. **That attended reload can replace dynamically installed
rules from VPNs or other networking software.** Inspect the generated change
and coordinate installation with those tools. Ordinary periodic recovery never
reloads the main ruleset or flushes unrelated rules or connections. Uninstall
removes the owned configuration and flushes only the nterprise anchor; it does
not disable PF for other services.

If another program removes the main anchor dispatcher, the helper exits with a
diagnostic in `/var/log/dev.nterprise.pfctl.log`; it does not overwrite that
program's firewall policy. Reconcile the competing configuration and run
`nterprise doctor --fix` interactively. A competing HTTPS proxy is likewise an
operator decision. This service cannot prevent unrelated software from owning
port 443 or rewriting the main firewall configuration.

After upgrading, noninteractive `doctor --fix` and dev preflight allow 35 seconds
for the installed service to restore a broken HTTPS path. They still require a
successful TLS+SNI probe, and report failure if recovery does not occur. No
alternate E2E hostname or port is introduced. Read-only `doctor` reports the
current state without waiting.

To validate an upgrade, run `nterprise doctor` and fetch the consuming project's
canonical HTTPS URLs. Testing PF disable/rule-loss recovery requires a controlled
machine: it changes shared host networking. Unit tests execute the actual shell
helper with a fake `pfctl` to verify repair and non-interference behavior, but do
not substitute for this privileged integration check.
