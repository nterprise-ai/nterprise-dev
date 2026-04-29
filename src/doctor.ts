/**
 * nterprise doctor — diagnose + fix dev-environment prerequisites.
 *
 * Owns the system-state install logic that's identical across every consuming
 * repo (LaunchDaemon for the pfctl 443→1355 rule). Per-project concerns
 * (env stubs, .next caches) stay in each project's own scripts/dev.sh.
 *
 * Subcommands wired from cli.ts:
 *   nterprise doctor          — read-only diagnostic, exits 0 if all checks pass
 *   nterprise doctor --fix    — install missing prerequisites (one sudo prompt)
 *   nterprise uninstall       — tear down the LaunchDaemon + anchor file
 *
 * Also exports runPreflight() which createDevServer calls before spawning
 * workers, so even a bare `nterprise` invocation surfaces missing pieces
 * with a clear "run nterprise doctor --fix" hint.
 *
 * Migration: when an old `dev.portfree.pfctl` LaunchDaemon is detected,
 * `nterprise doctor --fix` boots it out and removes its plist + anchor before
 * installing the new `dev.nterprise.pfctl` daemon. One combined sudo prompt.
 */

import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasPortless } from "./portless";

// ---- Constants ------------------------------------------------------------

const LABEL = "dev.nterprise.pfctl";
const ANCHOR_PATH = "/etc/pf.anchors/dev.nterprise.pfctl";
const PLIST_PATH = "/Library/LaunchDaemons/dev.nterprise.pfctl.plist";

const OLD_LABEL = "dev.portfree.pfctl";
const OLD_ANCHOR_PATH = "/etc/pf.anchors/dev.portfree.pfctl";
const OLD_PLIST_PATH = "/Library/LaunchDaemons/dev.portfree.pfctl.plist";

const TLS_PORT = 1355;
const HTTPS_PORT = 443;

const ANCHOR_BODY = `rdr pass on lo0 inet proto tcp from any to any port ${HTTPS_PORT} -> 127.0.0.1 port ${TLS_PORT}\n`;

const PLIST_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/sbin/pfctl</string>
        <string>-Ef</string>
        <string>${ANCHOR_PATH}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>/var/log/${LABEL}.log</string>
    <key>StandardOutPath</key>
    <string>/var/log/${LABEL}.log</string>
</dict>
</plist>
`;

// ---- Old-daemon detection (used by migration + first-run guard) ------------

/**
 * Returns true if a legacy `dev.portfree.pfctl` LaunchDaemon plist exists on
 * disk. Pure file-system check — does not require sudo.
 *
 * Exported for testability; consumers (createDevServer) use this to bail with
 * "run nterprise doctor --fix" rather than silently installing both daemons.
 */
export function oldDaemonPresent(): boolean {
	if (process.platform !== "darwin") return false;
	return existsSync(OLD_PLIST_PATH) || existsSync(OLD_ANCHOR_PATH);
}

// ---- Check primitives -----------------------------------------------------

interface CheckResult {
	name: string;
	ok: boolean;
	message: string;
	/** Action to take when fixing; absent if the check is informational only. */
	fix?: () => Promise<void>;
}

function tcpProbe(host: string, port: number): boolean {
	try {
		const r = Bun.spawnSync(["nc", "-z", "-G", "1", host, String(port)], {
			stdout: "pipe",
			stderr: "pipe",
		});
		if (r.exitCode === 0) return true;
	} catch {
		// fall through
	}
	try {
		const r = Bun.spawnSync(["nc", "-z", "-w", "1", host, String(port)], {
			stdout: "pipe",
			stderr: "pipe",
		});
		return r.exitCode === 0;
	} catch {
		return false;
	}
}

type RuleStatus = "active" | "missing" | "unknown";

function pfctlRuleStatus(): RuleStatus {
	// First try: sudo -n is authoritative when cred is cached. Returns
	// "active" or "missing" with confidence.
	try {
		const r = Bun.spawnSync(["sudo", "-n", "pfctl", "-sn"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		if (r.exitCode === 0) {
			const out = new TextDecoder().decode(r.stdout);
			return /443.*1355/.test(out) ? "active" : "missing";
		}
	} catch {
		// fall through to TCP probe
	}

	// sudo cred isn't cached (no auth, no prompt allowed at probe time).
	// Use a TCP-level probe as a proxy signal.
	//
	// IMPORTANT: this only tells us anything when the portless TLS proxy
	// is itself listening on :1355. If :1355 is down (cold start, before
	// nterprise has launched the proxy), :443 is unreachable regardless of
	// the pfctl rule's existence — so we can't distinguish "rule missing"
	// from "proxy not yet up". Return "unknown" in that case.
	const proxyUp = tcpProbe("127.0.0.1", TLS_PORT);
	if (!proxyUp) return "unknown";
	return tcpProbe("127.0.0.1", HTTPS_PORT) ? "active" : "missing";
}

/** Backwards-compatible boolean wrapper. Treats "unknown" as not-active. */
function pfctlRuleActive(): boolean {
	return pfctlRuleStatus() === "active";
}

function launchDaemonInstalled(): boolean {
	if (!existsSync(PLIST_PATH)) return false;
	if (!existsSync(ANCHOR_PATH)) return false;
	try {
		const r = Bun.spawnSync(["launchctl", "print", `system/${LABEL}`], {
			stdout: "pipe",
			stderr: "pipe",
		});
		return r.exitCode === 0;
	} catch {
		return false;
	}
}

function bunVersionOk(): { ok: boolean; version: string } {
	try {
		const r = Bun.spawnSync(["bun", "--version"], { stdout: "pipe", stderr: "pipe" });
		if (r.exitCode !== 0) return { ok: false, version: "" };
		const version = new TextDecoder().decode(r.stdout).trim();
		const [maj, min] = version.split(".").map((n) => parseInt(n, 10));
		const ok = maj > 1 || (maj === 1 && min >= 3);
		return { ok, version };
	} catch {
		return { ok: false, version: "" };
	}
}

// ---- sudo helper ----------------------------------------------------------

function isInteractive(): boolean {
	return Boolean(process.stdin.isTTY);
}

async function runSudo(args: string[]): Promise<void> {
	if (!isInteractive()) {
		throw new Error(
			`sudo command needed but stdin is not a TTY: sudo ${args.join(" ")}\n` +
				`Re-run nterprise interactively, or run the command manually.`,
		);
	}
	const proc = Bun.spawn(["sudo", ...args], {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const code = await proc.exited;
	if (code !== 0) {
		throw new Error(`sudo ${args.join(" ")} exited ${code}`);
	}
}

// ---- Migration ------------------------------------------------------------

/**
 * Tear down a legacy `dev.portfree.pfctl` LaunchDaemon, if present.
 *
 * Sequence (each step idempotent — failures of "already gone" are swallowed):
 *   1. launchctl bootout system/dev.portfree.pfctl
 *   2. rm /Library/LaunchDaemons/dev.portfree.pfctl.plist
 *   3. rm /etc/pf.anchors/dev.portfree.pfctl
 *
 * Caller is responsible for printing the migration preamble before invoking
 * (so the user understands the upcoming sudo prompt).
 *
 * Exported so tests can drive the migration sequence without going through
 * the full `runDoctor({ fix: true })` path.
 */
export async function migrateOldDaemon(opts?: {
	runSudo?: (args: string[]) => Promise<void>;
	fileExists?: (path: string) => boolean;
}): Promise<boolean> {
	const sudo = opts?.runSudo ?? runSudo;
	const exists = opts?.fileExists ?? existsSync;

	const plistExists = exists(OLD_PLIST_PATH);
	const anchorExists = exists(OLD_ANCHOR_PATH);
	if (!plistExists && !anchorExists) return false;

	console.log(`   → migrating LaunchDaemon: ${OLD_LABEL} → ${LABEL}`);

	// bootout is idempotent in practice — if not loaded, it errors out and we
	// just keep going. Wrap in try/catch so a not-loaded daemon doesn't block
	// the rest of the cleanup.
	try {
		await sudo(["launchctl", "bootout", `system/${OLD_LABEL}`]);
	} catch {
		// ignore — daemon may already be unloaded
	}

	if (plistExists) {
		await sudo(["rm", "-f", OLD_PLIST_PATH]);
	}
	if (anchorExists) {
		await sudo(["rm", "-f", OLD_ANCHOR_PATH]);
	}

	console.log(`   ✓ Old LaunchDaemon (${OLD_LABEL}) removed.`);
	return true;
}

// ---- Install + uninstall --------------------------------------------------

async function installLaunchDaemon(): Promise<void> {
	if (process.platform !== "darwin") {
		throw new Error(
			"LaunchDaemon install is macOS-only. On Linux, configure the equivalent at " +
				"/etc/pf.conf or via systemd; on Windows, use NRPT / hosts entries.",
		);
	}

	// Migration: if an old portfree daemon is present, tear it down BEFORE
	// installing the new label. One combined sudo session via cred caching.
	if (oldDaemonPresent()) {
		console.log(
			`\n   Migrating LaunchDaemon: ${OLD_LABEL} → ${LABEL}\n   (one sudo prompt covers both teardown and install)`,
		);
		await migrateOldDaemon();
	}

	const dir = mkdtempSync(join(tmpdir(), "nterprise-doctor-"));
	const tmpAnchor = join(dir, "anchor");
	const tmpPlist = join(dir, "plist");
	writeFileSync(tmpAnchor, ANCHOR_BODY);
	writeFileSync(tmpPlist, PLIST_BODY);

	console.log(`   → installing LaunchDaemon (${LABEL}); sudo prompt incoming…`);
	await runSudo(["install", "-m", "0644", tmpAnchor, ANCHOR_PATH]);
	await runSudo(["install", "-m", "0644", tmpPlist, PLIST_PATH]);

	// Bootstrap is the modern launchctl API (macOS 10.10+).
	// If it's already loaded, re-running may error; bootout first to keep idempotent.
	try {
		await runSudo(["launchctl", "bootout", `system/${LABEL}`]);
	} catch {
		// ignore — daemon may not be loaded yet
	}
	try {
		await runSudo(["launchctl", "bootstrap", "system", PLIST_PATH]);
	} catch {
		// fall back to legacy load on older macOS
		await runSudo(["launchctl", "load", PLIST_PATH]);
	}

	// Verify the rule is now active.
	if (!pfctlRuleActive()) {
		throw new Error(`pfctl rule did not activate after install — check /var/log/${LABEL}.log`);
	}
	console.log("   ✓ LaunchDaemon installed; pfctl rule is reboot-persistent.");
}

async function uninstallLaunchDaemon(): Promise<void> {
	if (process.platform !== "darwin") return;
	console.log(`   → removing LaunchDaemon (${LABEL}); sudo prompt incoming…`);
	try {
		await runSudo(["launchctl", "bootout", `system/${LABEL}`]);
	} catch {
		// ignore — already unloaded
	}
	if (existsSync(PLIST_PATH)) await runSudo(["rm", "-f", PLIST_PATH]);
	if (existsSync(ANCHOR_PATH)) await runSudo(["rm", "-f", ANCHOR_PATH]);
	// Flush the running ruleset so the NAT rule is removed without reboot.
	try {
		await runSudo(["pfctl", "-F", "all"]);
	} catch {
		// ignore — pfctl may already be empty
	}
	console.log("   ✓ LaunchDaemon removed.");
}

// ---- Check runners --------------------------------------------------------

function gatherChecks(): CheckResult[] {
	const checks: CheckResult[] = [];

	const bun = bunVersionOk();
	checks.push({
		name: "bun >= 1.3",
		ok: bun.ok,
		message: bun.ok ? bun.version : `${bun.version || "not found"} — install: https://bun.sh`,
	});

	checks.push({
		name: "portless CLI installed",
		ok: hasPortless(),
		message: hasPortless()
			? "ok"
			: "not found — install: bun install -g portless (or npm install -g portless)",
	});

	if (process.platform === "darwin") {
		// Surface old-daemon presence so `nterprise doctor` (read-only) reports
		// it. The fix is part of installLaunchDaemon's sequence; we represent
		// it as a separate check so the user sees it called out clearly.
		const oldPresent = oldDaemonPresent();
		if (oldPresent) {
			checks.push({
				name: `legacy ${OLD_LABEL} present`,
				ok: false,
				message: `needs migration — run: nterprise doctor --fix`,
				fix: installLaunchDaemon, // installLaunchDaemon migrates first then installs new
			});
		}

		const ldOk = launchDaemonInstalled();
		checks.push({
			name: "pfctl LaunchDaemon installed",
			ok: ldOk,
			message: ldOk ? `loaded (${LABEL})` : `missing — run: nterprise doctor --fix`,
			fix: ldOk ? undefined : installLaunchDaemon,
		});

		const ruleStatus = pfctlRuleStatus();
		// Tri-state semantics:
		//   active  → ✓ confirmed by sudo or by reachable :443+:1355
		//   missing → ✗ confirmed broken; needs kickstart or daemon reinstall
		//   unknown → ✓ informational; sudo cred uncached AND proxy not yet up,
		//             so we can't prove either way. Don't auto-fix — the
		//             LaunchDaemon's job is to keep the rule alive, and
		//             auto-fixing here causes spurious sudo prompts on every
		//             cold-start `bun run dev`. User can run `nterprise doctor`
		//             explicitly (with sudo) for a definitive check.
		const ruleMessage = {
			active: "active",
			missing: "missing — run: nterprise doctor --fix",
			unknown: "can't verify (sudo not cached, proxy not up); trusting LaunchDaemon",
		}[ruleStatus];
		checks.push({
			name: "pfctl 443 → 1355 rule active",
			ok: ruleStatus !== "missing",
			message: ruleMessage,
			// Only fix when definitively missing.
			fix:
				ruleStatus !== "missing"
					? undefined
					: ldOk
						? async () => {
								await runSudo(["launchctl", "kickstart", "-k", `system/${LABEL}`]);
								if (pfctlRuleStatus() === "missing") {
									throw new Error(
										`pfctl rule still missing after kickstart — see /var/log/${LABEL}.log`,
									);
								}
							}
						: installLaunchDaemon,
		});
	} else {
		checks.push({
			name: "platform support",
			ok: true,
			message: `skipped on ${process.platform} — boot-time pfctl install is macOS-only`,
		});
	}

	// Proxy state is informational — nterprise starts it on demand. Never a
	// blocking failure; just a status line so users can see the current state.
	const proxyUp = tcpProbe("127.0.0.1", TLS_PORT);
	checks.push({
		name: `portless TLS proxy on :${TLS_PORT}`,
		ok: true,
		message: proxyUp ? "running" : "not running — will be started by `nterprise`",
	});

	return checks;
}

function printChecks(checks: CheckResult[]): void {
	console.log("\nnterprise doctor:\n");
	for (const c of checks) {
		const mark = c.ok ? "✓" : "✗";
		console.log(`  ${mark} ${c.name}: ${c.message}`);
	}
	console.log("");
}

// ---- Public entrypoints ---------------------------------------------------

export async function runDoctor(opts: { fix: boolean }): Promise<number> {
	const checks = gatherChecks();
	printChecks(checks);

	const failures = checks.filter((c) => !c.ok);
	if (failures.length === 0) {
		console.log("✅ All checks passed.\n");
		return 0;
	}

	if (!opts.fix) {
		console.log(
			`${failures.length} check(s) failed. Run \`nterprise doctor --fix\` to install missing components.\n`,
		);
		return 1;
	}

	const fixable = failures.filter((c) => c.fix);
	const unfixable = failures.filter((c) => !c.fix);

	if (fixable.length === 0) {
		console.log("Nothing to auto-fix. The remaining failures need manual attention.\n");
		return unfixable.length > 0 ? 1 : 0;
	}

	// Multiple checks may share the same fix function (e.g. installLaunchDaemon
	// is the fix for both "old daemon present" and "new daemon missing").
	// Dedupe by reference so we run each fix at most once per pass.
	const seenFixes = new Set<() => Promise<void>>();
	for (const c of fixable) {
		if (!c.fix || seenFixes.has(c.fix)) continue;
		seenFixes.add(c.fix);
		try {
			await c.fix();
		} catch (err) {
			console.error(`✗ ${c.name}: ${(err as Error).message}\n`);
			return 1;
		}
	}

	// Re-run checks to confirm
	const recheck = gatherChecks();
	const stillFailing = recheck.filter((c) => !c.ok);
	if (stillFailing.length > 0) {
		console.log("\nAfter fixes, some checks still fail:\n");
		printChecks(stillFailing);
		return 1;
	}
	console.log("✅ All checks passed after fixes.\n");
	return 0;
}

export async function runUninstall(): Promise<number> {
	console.log("\nnterprise uninstall — removing system state.\n");
	await uninstallLaunchDaemon();
	console.log("");
	return 0;
}

/**
 * Called by createDevServer at startup. Two modes:
 *
 * - **Interactive (TTY)**: when the LaunchDaemon is missing, install it
 *   directly (one-time sudo prompt). Same UX a per-repo `dev.sh` shim used
 *   to provide. After this returns, the dev stack starts normally.
 *
 * - **Non-interactive (CI / Docker / piped)**: print a warning and continue.
 *   Clean URLs will fall back to `:1355`, but the build doesn't fail.
 *
 * This is the keystone that lets bare `nterprise` replace per-repo dev.sh
 * shims entirely — the only system-state install path goes through here.
 *
 * The explicit `nterprise doctor --fix` subcommand still exists for scripted
 * installs, re-installs, and out-of-band debugging.
 *
 * If a legacy `dev.portfree.pfctl` daemon is present, this bails with an
 * actionable error (rather than silently double-installing) so the user
 * runs `nterprise doctor --fix` and gets the migration prompt.
 */
export async function runPreflightOrFix(): Promise<void> {
	if (process.platform !== "darwin") return;

	if (oldDaemonPresent()) {
		console.error(
			`\n⚠ Legacy LaunchDaemon detected (${OLD_LABEL}). Run\n\n   nterprise doctor --fix\n\n` +
				`to migrate. nterprise dev cannot start cleanly with both daemons present.\n`,
		);
		process.exit(1);
	}

	const checks = gatherChecks();
	const failures = checks.filter((c) => !c.ok);
	if (failures.length === 0) return;

	// Only act on boot-persistence pieces; the proxy will be started below,
	// and bun/portless not-installed errors are handled elsewhere with
	// actionable messages.
	const bootIssues = failures.filter(
		(c) => c.name === "pfctl LaunchDaemon installed" || c.name === "pfctl 443 → 1355 rule active",
	);
	if (bootIssues.length === 0) return;

	if (!isInteractive()) {
		console.log(
			"\n⚠ Boot-persistence not configured. Clean https://*.<tld> URLs " +
				"will fail until you run (interactively):\n\n   nterprise doctor --fix\n",
		);
		return;
	}

	// Interactive: drive the same `--fix` path the user would invoke explicitly.
	console.log("\n→ first-run setup: installing pfctl LaunchDaemon (one-time)…");
	const code = await runDoctor({ fix: true });
	if (code !== 0) {
		console.log(
			"\n⚠ Auto-install did not complete. Continuing without boot-persistence — " +
				"clean https URLs may not work until you run `nterprise doctor --fix`.\n",
		);
	}
}

/** @deprecated kept for backwards compatibility; new callers use runPreflightOrFix. */
export function runPreflight(): void {
	void runPreflightOrFix();
}
