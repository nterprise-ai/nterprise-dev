import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { runPreflightOrFix } from "./doctor";
import { ensureEnvFiles } from "./env-files";
import { hasPortless } from "./portless";
import { loadEnvStack } from "./read-env-stack";
import type { AppConfig, DevServerConfig, ResolvedDevServerConfig, TenantConfig } from "./types";

interface RouteEntry {
	hostname: string;
	port: number;
	pid: number;
}

const PORTLESS_DIR = join(homedir(), ".portless");
const ROUTES_PATH = join(PORTLESS_DIR, "routes.json");
const ROUTES_LOCK_PATH = join(PORTLESS_DIR, "routes.lock");
const STALE_LOCK_THRESHOLD_MS = 10_000;
const LOCK_MAX_RETRIES = 20;
const LOCK_RETRY_DELAY_MS = 50;
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function portlessEnv(): NodeJS.ProcessEnv {
	return {
		...process.env,
		PORTLESS_STATE_DIR: PORTLESS_DIR,
		PORTLESS_SYNC_HOSTS: "0",
	};
}

function syncSleep(ms: number): void {
	Atomics.wait(sleepBuffer, 0, 0, ms);
}

function acquireRouteLock(
	maxRetries = LOCK_MAX_RETRIES,
	retryDelayMs = LOCK_RETRY_DELAY_MS,
): boolean {
	for (let i = 0; i < maxRetries; i++) {
		try {
			mkdirSync(ROUTES_LOCK_PATH);
			return true;
		} catch (err) {
			const error = err as NodeJS.ErrnoException;
			if (error.code === "EEXIST") {
				try {
					const stat = statSync(ROUTES_LOCK_PATH);
					if (Date.now() - stat.mtimeMs > STALE_LOCK_THRESHOLD_MS) {
						rmSync(ROUTES_LOCK_PATH, { recursive: true, force: true });
						continue;
					}
				} catch {
					continue;
				}
				syncSleep(retryDelayMs);
				continue;
			}
			return false;
		}
	}
	return false;
}

function releaseRouteLock(): void {
	try {
		rmSync(ROUTES_LOCK_PATH, { recursive: true, force: true });
	} catch {
		// ignore
	}
}

function ensureSharedStateDir(tld: string): void {
	mkdirSync(PORTLESS_DIR, { recursive: true });
	const portlessTld = tld.includes(".") ? (tld.split(".").pop() ?? tld) : tld;
	writeFileSync(join(PORTLESS_DIR, "proxy.tld"), portlessTld);
}

export function normalizeConfig(config: DevServerConfig): ResolvedDevServerConfig {
	const { projectName, apps, envFiles, devCommand, tenants, tld, https } = config;

	const normalizedApps: AppConfig[] = apps.map((app, i) =>
		typeof app === "string"
			? {
					name: projectName ? `${projectName}-${app}` : app,
					filter: projectName ? `@${projectName}/${app}` : app,
					defaultPort: 3000 + i,
				}
			: app,
	);

	const normalizedEnvFiles: string[] = envFiles ?? [
		".env.local",
		...apps.filter((a): a is string => typeof a === "string").map((a) => `apps/${a}/.env.local`),
	];

	const normalizedTenants =
		tenants && projectName && !tenants.app.includes("-")
			? { ...tenants, app: `${projectName}-${tenants.app}` }
			: tenants;

	return {
		projectName,
		apps: normalizedApps,
		envFiles: normalizedEnvFiles,
		devCommand,
		tenants: normalizedTenants,
		tld,
		https,
	};
}

function getProxyPort(): number {
	try {
		return parseInt(readFileSync(join(PORTLESS_DIR, "proxy.port"), "utf8").trim(), 10) || 1355;
	} catch {
		return 1355;
	}
}

/**
 * Returns true if the portless local CA is already in the macOS system
 * keychain — which means trust has already been set up and we can skip
 * `portless trust`.
 *
 * Why this matters: `portless trust` invokes the macOS `security` tool to
 * apply trust settings, which always pops a "Certificate Trust Settings"
 * dialog (Touch ID / password). If we re-run it on every `bun run dev`,
 * the user sees that dialog every time. Detecting the existing trust
 * with `security find-certificate` (which is silent and read-only) lets
 * us short-circuit when nothing's needed.
 */
function isPortlessCaTrusted(): boolean {
	if (process.platform !== "darwin") return true; // trust-set is macOS-only here
	try {
		const r = Bun.spawnSync(
			[
				"security",
				"find-certificate",
				"-c",
				"portless Local CA",
				"/Library/Keychains/System.keychain",
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		return r.exitCode === 0;
	} catch {
		return false;
	}
}

function trustCa(): void {
	if (isPortlessCaTrusted()) return; // already trusted — don't re-prompt
	try {
		Bun.spawnSync(["portless", "trust"], {
			stdout: "pipe",
			stderr: "pipe",
			env: portlessEnv(),
		});
	} catch {
		// non-fatal
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function cleanLockFiles(): void {
	try {
		const result = Bun.spawnSync(["find", "apps", "-path", "*/.next/dev/lock", "-type", "f"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0) return;
		const files = new TextDecoder().decode(result.stdout).trim().split("\n").filter(Boolean);
		for (const file of files) {
			try {
				rmSync(file);
			} catch {
				// ignore
			}
		}
	} catch {
		// ignore
	}
}

/**
 * Kill any listener currently bound to the given TCP port. Returns the number
 * of processes killed. Self-aware: skips its own PID so nterprise can't kill
 * itself when called concurrently with a sibling check.
 */
function killListenersOnPort(port: number): number {
	try {
		const r = Bun.spawnSync(["lsof", `-tiTCP:${port}`, "-sTCP:LISTEN"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		if (r.exitCode !== 0) return 0;
		const pids = new TextDecoder()
			.decode(r.stdout)
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((s) => parseInt(s, 10))
			.filter((n) => Number.isFinite(n) && n > 0 && n !== process.pid);
		let killed = 0;
		for (const pid of pids) {
			try {
				process.kill(pid, "SIGKILL");
				killed++;
			} catch {
				// pid may have died between lsof and kill — ignore
			}
		}
		return killed;
	} catch {
		return 0;
	}
}

/**
 * Pre-flight: clear orphan listeners from the configured app ports before
 * spawning fresh dev servers. Without this, a previous `bun run dev` that
 * was killed via "close terminal" (no SIGINT/SIGTERM to nterprise) leaves
 * dev workers running, which makes the next `bun run dev` fail with
 * EADDRINUSE on those ports.
 *
 * Mirrors the brute-force kill that lived in per-repo scripts/dev.sh
 * before nterprise absorbed the entry-point role. Only operates on ports
 * that the app config explicitly assigned (`defaultPort`); apps that
 * use dynamic allocation are unaffected. Never touches the portless
 * TLS proxy port (1355).
 */
function cleanOrphanPorts(apps: AppConfig[]): void {
	const ports = apps
		.map((a) => a.defaultPort)
		.filter((p): p is number => typeof p === "number" && p > 0);
	if (ports.length === 0) return;

	let totalKilled = 0;
	for (const port of ports) {
		totalKilled += killListenersOnPort(port);
	}
	if (totalKilled > 0) {
		console.log(`  cleanup: killed ${totalKilled} orphan listener(s) on configured app ports`);
	}
}

async function isProxyRunning(port: number): Promise<boolean> {
	try {
		const lsof = Bun.spawnSync(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		if (lsof.exitCode === 0) return true;
	} catch {
		// ignore
	}

	for (const host of ["localhost", "::1", "127.0.0.1"]) {
		try {
			const nc = Bun.spawnSync(["nc", "-z", "-w", "1", host, String(port)], {
				stdout: "pipe",
				stderr: "pipe",
			});
			if (nc.exitCode === 0) return true;
		} catch {
			// ignore
		}
	}

	return false;
}

async function ensureProxyRunning(useHttps: boolean): Promise<void> {
	const port = getProxyPort();
	if (await isProxyRunning(port)) return;

	Bun.spawnSync(["portless", "proxy", "stop"], {
		stdout: "pipe",
		stderr: "pipe",
		env: portlessEnv(),
	});

	console.log("   Starting portless proxy...");
	const args = ["portless", "proxy", "start"];
	if (useHttps) args.push("--https");

	const proc = Bun.spawn(args, {
		stdout: "pipe",
		stderr: "pipe",
		env: portlessEnv(),
	});

	for (let i = 0; i < 150; i++) {
		await Bun.sleep(200);
		if (await isProxyRunning(port)) {
			console.log(`   Proxy running on port ${port}`);
			return;
		}
	}

	await proc.exited;

	if (await isProxyRunning(port)) {
		console.log(`   Proxy running on port ${port}`);
		return;
	}

	console.error(`\n   Portless proxy failed to start on port ${port}.`);
	console.error(
		"   Try manually: PORTLESS_STATE_DIR=$HOME/.portless portless proxy start --foreground --https\n",
	);
	process.exit(1);
}

function hasPortForwarding(): boolean {
	if (process.platform !== "darwin") return false;

	for (const host of ["localhost", "::1", "127.0.0.1"]) {
		try {
			const result = Bun.spawnSync(["nc", "-z", "-w", "1", host, "443"], {
				stdout: "pipe",
				stderr: "pipe",
			});
			if (result.exitCode === 0) return true;
		} catch {
			// ignore
		}
	}

	return false;
}

async function hostnameResolves(hostname: string): Promise<boolean> {
	try {
		const result = Bun.spawnSync(["dscacheutil", "-q", "host", "-a", "name", hostname], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const out = new TextDecoder().decode(result.stdout);
		return out.includes("ip_address:");
	} catch {
		return false;
	}
}

async function isPortAvailable(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		server.once("error", () => resolve(false));
		server.listen(port, "127.0.0.1", () => {
			server.close(() => resolve(true));
		});
	});
}

async function findAppPort(preferred?: number): Promise<number> {
	if (preferred && (await isPortAvailable(preferred))) {
		return preferred;
	}

	for (let attempt = 0; attempt < 100; attempt++) {
		const port = 4000 + Math.floor(Math.random() * 1000);
		if (await isPortAvailable(port)) return port;
	}

	throw new Error("Could not find a free app port");
}

function readRoutes(): RouteEntry[] {
	try {
		const raw = readFileSync(ROUTES_PATH, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((entry): entry is RouteEntry => {
			if (typeof entry !== "object" || entry === null) return false;
			const route = entry as RouteEntry;
			return (
				typeof route.hostname === "string" &&
				typeof route.port === "number" &&
				typeof route.pid === "number"
			);
		});
	} catch {
		return [];
	}
}

function writeRoutes(routes: RouteEntry[]): void {
	mkdirSync(PORTLESS_DIR, { recursive: true });
	// Write in place so the upstream portless file watcher keeps tracking this file.
	writeFileSync(ROUTES_PATH, JSON.stringify(routes, null, 2));
}

function withRoutesLock<T>(fn: (routes: RouteEntry[]) => T): T {
	if (!acquireRouteLock()) {
		throw new Error("Failed to acquire route lock");
	}
	try {
		const routes = readRoutes().filter((route) => route.pid === 0 || isProcessAlive(route.pid));
		const next = fn(routes);
		return next;
	} finally {
		releaseRouteLock();
	}
}

function upsertRoutes(entries: RouteEntry[]): void {
	withRoutesLock((routes) => {
		const remaining = routes.filter(
			(route) => !entries.some((entry) => entry.hostname === route.hostname),
		);
		writeRoutes([...remaining, ...entries]);
	});
}

function removeRoutes(hostnames: string[]): void {
	withRoutesLock((routes) => {
		writeRoutes(routes.filter((route) => !hostnames.includes(route.hostname)));
	});
}

function appHostname(app: AppConfig, tld?: string): string {
	if (!tld) return app.name;
	if (app.root) return tld;
	return `${app.name}.${tld}`;
}

function publicUrl(hostname: string, useHttps: boolean): string {
	if (useHttps && hasPortForwarding()) return `https://${hostname}`;
	if (useHttps) return `https://${hostname}:1355`;
	return `http://${hostname}:1355`;
}

async function resolveTenantSlugs(tenants: TenantConfig | undefined): Promise<string[]> {
	if (!tenants) return [];
	const raw = tenants.slugs;
	return Array.isArray(raw) ? raw : await raw();
}

function tenantHostname(slug: string, tenants: TenantConfig, app: AppConfig, tld?: string): string {
	const aliasBase = tenants.slugToAlias
		? tenants.slugToAlias(slug, app.name)
		: `${slug}.${app.name}`;
	return tld ? `${aliasBase}.${tld}` : aliasBase;
}

export async function createDevServer(config: ResolvedDevServerConfig): Promise<void> {
	const { projectName, apps, envFiles, devCommand = "dev", tenants } = config;
	const configTld = config.tld;
	const useHttps = config.https ?? false;

	console.log(`\nStarting ${projectName} dev environment...\n`);
	ensureEnvFiles(envFiles);

	// Load .env.dev defaults BEFORE child spawns so strict-validation libraries
	// (e.g. @t3-oss/env-nextjs) see fallbacks at import time. Real values from
	// .env.local are loaded by each app's framework on top of these.
	const envResult = loadEnvStack();
	if (envResult.loaded) {
		console.log(
			`  .env.dev: applied ${envResult.applied} default(s), skipped ${envResult.skipped} (already set)`,
		);
	}

	if (!hasPortless()) {
		console.error("   portless not found. Install: npm install -g portless");
		process.exit(1);
	}

	if (configTld) {
		cleanLockFiles();
		// Clear orphan listeners on configured app ports before starting. This
		// ensures every `bun run dev` resets cleanly even when a previous
		// session was killed without SIGINT (terminal closed, crashed, agent
		// got confused, etc.). Apps without an explicit defaultPort use
		// dynamic allocation and are unaffected.
		cleanOrphanPorts(apps);
		ensureSharedStateDir(configTld);
		await ensureProxyRunning(useHttps);
		if (useHttps) trustCa();
		// runPreflightOrFix: in interactive shells with the LaunchDaemon missing,
		// auto-runs the install (one sudo prompt). In non-interactive (CI/Docker),
		// it just warns. Eliminates the per-repo `dev.sh` shim that used to do
		// this manually.
		if (useHttps) await runPreflightOrFix();
	} else {
		const proxyPort = getProxyPort();
		if (!(await isProxyRunning(proxyPort))) {
			console.error(`   portless proxy not running (port ${proxyPort}).`);
			process.exit(1);
		}
	}

	const managedHosts = apps.map((app) => appHostname(app, configTld));
	removeRoutes(managedHosts);

	const unresolved: string[] = [];
	for (const hostname of managedHosts) {
		if (!(await hostnameResolves(hostname))) {
			unresolved.push(hostname);
		}
	}

	if (unresolved.length > 0) {
		console.log(
			`   Warning: these hostnames do not currently resolve locally:\n${unresolved
				.map((hostname) => `   - ${hostname}`)
				.join("\n")}`,
		);
		console.log(
			"   Continuing anyway. If they should resolve locally, add DNS or /etc/hosts entries.",
		);
	}

	const children: Bun.Subprocess[] = [];
	const routeEntries: RouteEntry[] = [];

	for (const app of apps) {
		const cmd = app.command ?? devCommand;
		const port = await findAppPort(app.defaultPort);
		const hostname = appHostname(app, configTld);
		const url = publicUrl(hostname, useHttps);

		console.log(`\n  -> ${url}\n`);
		console.log(
			`Running: PORT=${port} HOST=127.0.0.1 PORTLESS_URL=${url} bun run --filter=${app.filter} ${cmd}\n`,
		);

		const proc = Bun.spawn(["bun", "run", `--filter=${app.filter}`, cmd], {
			stdout: "inherit",
			stderr: "inherit",
			env: {
				...process.env,
				PORT: String(port),
				HOST: "127.0.0.1",
				PORTLESS_URL: url,
			},
		});

		routeEntries.push({ hostname, port, pid: proc.pid });
		children.push(proc);
	}

	if (tenants) {
		const tenantApp = apps.find((app) => app.name === tenants.app);
		const tenantPort = tenantApp
			? routeEntries.find((route) => route.hostname === appHostname(tenantApp, configTld))?.port
			: undefined;
		if (tenantApp && tenantPort) {
			const slugs = await resolveTenantSlugs(tenants);
			for (const slug of slugs) {
				const hostname = tenantHostname(slug, tenants, tenantApp, configTld);
				routeEntries.push({ hostname, port: tenantPort, pid: 0 });
			}
		}
	}

	upsertRoutes(routeEntries);

	function cleanup(): void {
		removeRoutes(routeEntries.map((route) => route.hostname));
		for (const child of children) {
			try {
				child.kill();
			} catch {
				// ignore
			}
		}
	}

	process.on("SIGINT", () => {
		cleanup();
		process.exit(0);
	});
	process.on("SIGTERM", () => {
		cleanup();
		process.exit(0);
	});

	const exitCodes = await Promise.all(children.map((proc) => proc.exited));
	cleanup();
	const failed = exitCodes.find((code) => code !== 0);
	if (failed) process.exit(failed);
}

export function createDevDown(config: ResolvedDevServerConfig): void {
	console.log(`dev-down: stopping ${config.projectName} dev processes...\n`);

	const hostnames = config.apps.map((app) => appHostname(app, config.tld));
	if (config.tenants && Array.isArray(config.tenants.slugs)) {
		const tenantApp = config.apps.find((app) => app.name === config.tenants?.app);
		if (tenantApp) {
			for (const slug of config.tenants.slugs) {
				hostnames.push(tenantHostname(slug, config.tenants, tenantApp, config.tld));
			}
		}
	}
	removeRoutes(hostnames);

	for (const app of config.apps) {
		try {
			Bun.spawnSync(["pkill", "-f", `--filter=${app.filter}`], {
				stdout: "pipe",
				stderr: "pipe",
			});
		} catch {
			// ignore
		}
	}

	console.log("dev-down: done.\n");
}
