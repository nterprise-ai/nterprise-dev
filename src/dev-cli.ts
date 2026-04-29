/**
 * `nterprise dev` subcommand handlers.
 *
 * Loads the project's package.json#nterprise (falls back to #portfree, then
 * legacy #portless) and dispatches:
 *   nterprise            → runDev("up", [])
 *   nterprise dev up     → createDevServer
 *   nterprise dev down   → createDevDown
 *   nterprise dev clean  → delete cleanPatterns globs, then up
 *   nterprise dev list   → portlessList (active routes table)
 */

import { readFileSync, rmSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { createDevDown, createDevServer, normalizeConfig } from "./dev-server";
import { portlessList } from "./portless";
import type { DevServerConfig, ResolvedDevServerConfig } from "./types";

interface LoadedConfig {
	cwd: string;
	config: ResolvedDevServerConfig;
}

function loadProjectConfig(): LoadedConfig {
	const cwd = process.cwd();
	let pkg: Record<string, unknown>;
	try {
		pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
	} catch {
		console.error("❌  No package.json found in current directory.");
		process.exit(1);
	}

	const config = (pkg.nterprise ?? pkg.portfree ?? pkg.portless) as DevServerConfig | undefined;
	if (!config) {
		console.error('❌  No "nterprise" key found in package.json.');
		console.error('    Add a "nterprise" section with projectName and apps:');
		console.error("");
		console.error('    "nterprise": {');
		console.error('      "projectName": "my-project",');
		console.error('      "apps": ["web", "api"]');
		console.error("    }");
		process.exit(1);
	}

	return { cwd, config: normalizeConfig(config) };
}

function applyCleanPatterns(cwd: string, patterns: string[]): void {
	if (patterns.length === 0) {
		console.log("→ clean: no cleanPatterns configured (no-op)");
		return;
	}
	console.log(`→ clean: removing matches for ${patterns.length} pattern(s)`);
	for (const pattern of patterns) {
		const glob = new Bun.Glob(pattern);
		let count = 0;
		for (const match of glob.scanSync({ cwd, onlyFiles: false, dot: false })) {
			const absolute = isAbsolute(match) ? match : join(cwd, match);
			// Refuse to delete anything outside cwd — defense-in-depth.
			const rel = relative(cwd, absolute);
			if (rel.startsWith("..") || isAbsolute(rel)) continue;
			rmSync(absolute, { recursive: true, force: true });
			count++;
		}
		console.log(`  ${pattern}: ${count} match(es)`);
	}
}

async function runListAction(): Promise<number> {
	const routes = await portlessList();
	if (routes.length === 0) {
		console.log("(no active portless routes)");
		return 0;
	}
	for (const r of routes) {
		const pidPart = r.pid > 0 ? `pid ${r.pid}` : "alias";
		console.log(`  ${r.url}  →  localhost:${r.port}  (${pidPart})`);
	}
	return 0;
}

/**
 * Entry point for the `nterprise dev …` group. Also handles the bare
 * `nterprise` invocation (action="up").
 *
 * `rest` is forwarded so legacy flags like `--clean`, `--down` continue to
 * work alongside the verb form.
 */
export async function runDev(action: string | undefined, rest: string[]): Promise<number> {
	// Normalize: bare `nterprise --down` and bare `nterprise --clean` are
	// kept working for back-compat with the previous portfree CLI.
	const flags = new Set(rest);
	if (action === "--down" || flags.has("--down")) action = "down";
	if (action === "--clean" || flags.has("--clean")) action = action === "down" ? "down" : "clean";

	const verb = action ?? "up";

	if (verb === "list") {
		return runListAction();
	}

	const { cwd, config } = loadProjectConfig();

	if (verb === "down") {
		createDevDown(config);
		return 0;
	}

	if (verb === "clean") {
		applyCleanPatterns(cwd, config.cleanPatterns ?? []);
		await createDevServer(config);
		return 0;
	}

	if (verb === "up") {
		await createDevServer(config);
		return 0;
	}

	console.error(
		`unknown action: nterprise dev ${verb}. Try one of: up | down | clean | list. See \`nterprise --help\`.`,
	);
	return 1;
}
