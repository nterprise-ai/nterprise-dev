/**
 * portless helpers — wraps the portless CLI (https://port1355.dev).
 *
 * One-time machine setup:
 *   npm install -g portless
 *   sudo portless proxy start --https --tld test
 *
 * The proxy writes /etc/hosts entries for .test domains on start (persists
 * across reboots, unlike slim's pf rules which reset on macOS updates).
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORTLESS_DIR = join(homedir(), ".portless");

/**
 * Read the active TLD from ~/.portless/proxy.tld.
 * Falls back to "localhost" if the file cannot be read.
 * Supports multi-segment TLDs like "dev.adalati.com".
 */
function getPortlessTld(): string {
	try {
		return readFileSync(join(PORTLESS_DIR, "proxy.tld"), "utf8").trim();
	} catch {
		return "localhost";
	}
}

export interface PortlessRoute {
	name: string;
	url: string;
	port: number;
	pid: number;
}

/** Returns true if portless CLI is installed */
export function hasPortless(): boolean {
	try {
		const r = Bun.spawnSync(["portless", "--version"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		return r.exitCode === 0;
	} catch {
		return false;
	}
}

/** List all active portless routes */
export async function portlessList(): Promise<PortlessRoute[]> {
	try {
		const r = Bun.spawnSync(["portless", "list"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		if (r.exitCode !== 0) return [];
		const text = new TextDecoder().decode(r.stdout).trim();
		if (!text) return [];
		// Parse human-readable output, e.g.:
		//   https://adalati-web.test:1355  ->  localhost:4966  (pid 60451)
		//   https://website.dev.adalati.com:1355  ->  localhost:4547  (pid 12345)
		//   https://demo.website.dev.adalati.com:1355  ->  localhost:4547  (alias)
		const routes: PortlessRoute[] = [];
		const lineRe = /https?:\/\/([^:]+):\d+\s+->\s+localhost:(\d+)\s+\((?:pid\s+(\d+)|alias)\)/;
		const tld = getPortlessTld();
		for (const line of text.split("\n")) {
			const m = line.match(lineRe);
			if (!m) continue;
			const fullHost = m[1]; // e.g. "adalati-web.test" or "website.dev.adalati.com"
			const port = parseInt(m[2], 10);
			const pid = m[3] ? parseInt(m[3], 10) : 0;
			// Strip the full TLD suffix (supports multi-segment TLDs like "dev.adalati.com").
			// Falls back to stripping the last segment if TLD does not match.
			const name = fullHost.endsWith(`.${tld}`)
				? fullHost.slice(0, -(tld.length + 1))
				: fullHost.split(".").slice(0, -1).join(".");
			routes.push({
				name,
				url: `https://${fullHost}`,
				port,
				pid,
			});
		}
		return routes;
	} catch {
		return [];
	}
}

/**
 * Get the app port for a named portless route.
 * Reads from `portless list` — only works if the app is currently running.
 */
export async function getPortlessAppPort(appName: string): Promise<number | null> {
	const routes = await portlessList();
	const match = routes.find(
		(r) => r.pid > 0 && (r.name === appName || r.url?.includes(`${appName}.`)),
	);
	return match?.port ?? null;
}

/**
 * Register a static alias route: portless alias <name> <port>
 * Used for tenant subdomains that share a port with an existing app.
 *
 * @param env Optional environment overrides (e.g. `{ HOME: "/tmp/nterprise-myproject" }`)
 *            to direct portless to a project-specific state directory.
 */
export async function portlessAlias(
	name: string,
	port: number,
	env?: NodeJS.ProcessEnv,
): Promise<void> {
	const proc = Bun.spawn(["portless", "alias", name, String(port)], {
		stdout: "inherit",
		stderr: "inherit",
		...(env ? { env } : {}),
	});
	await proc.exited;
}

/**
 * Remove a static alias route: portless alias --remove <name>
 */
export async function portlessAliasRemove(name: string): Promise<void> {
	try {
		const proc = Bun.spawn(["portless", "alias", "--remove", name], {
			stdout: "pipe",
			stderr: "pipe",
		});
		await proc.exited;
	} catch {
		// ignore — alias may not exist
	}
}
