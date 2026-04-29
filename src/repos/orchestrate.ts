/**
 * Multi-repo orchestrator — replaces `~/Projects/dev.sh`.
 *
 * `nterprise repos`            → up (default action)
 * `nterprise repos up`         → fan out `bun run dev` per registered repo
 * `nterprise repos down`       → stop each repo (prefer `bun run dev:down`)
 * `nterprise repos status`     → list pid + alive state per repo
 * `nterprise repos logs <name>`→ tail per-repo log file
 * `nterprise repos add <path>` → register a repo (name defaults to basename)
 * `nterprise repos remove <name>` → drop a repo from the registry
 * `nterprise repos list`       → print registry
 *
 * Each repo's runtime state lives at:
 *   ~/.config/nterprise/state/<name>.pid
 *   ~/.config/nterprise/state/<name>.log
 *
 * Same model as `dev.sh`: nohup + pid file + per-repo log file. Idempotent —
 * `up` skips repos whose pid file points at a live process.
 */

import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	addRepo,
	findRepo,
	loadRegistry,
	REGISTRY_PATH,
	type RepoEntry,
	removeRepo,
	STATE_DIR,
	saveRegistry,
} from "./registry";

function ensureStateDir(): void {
	mkdirSync(STATE_DIR, { recursive: true });
}

function pidPath(name: string): string {
	return join(STATE_DIR, `${name}.pid`);
}

function logPath(name: string): string {
	return join(STATE_DIR, `${name}.log`);
}

function isAlive(pid: number): boolean {
	if (!Number.isFinite(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function readPidFile(name: string): number | null {
	const p = pidPath(name);
	if (!existsSync(p)) return null;
	const raw = readFileSync(p, "utf8").trim();
	const pid = parseInt(raw, 10);
	if (!Number.isFinite(pid)) return null;
	return pid;
}

function clearPidFile(name: string): void {
	const p = pidPath(name);
	if (existsSync(p)) {
		try {
			Bun.spawnSync(["rm", "-f", p], { stdout: "pipe", stderr: "pipe" });
		} catch {
			// ignore
		}
	}
}

function startRepo(repo: RepoEntry): "started" | "already-running" | "missing-path" {
	if (!existsSync(repo.path)) return "missing-path";

	const existingPid = readPidFile(repo.name);
	if (existingPid && isAlive(existingPid)) return "already-running";

	ensureStateDir();
	const log = logPath(repo.name);
	const pid = pidPath(repo.name);

	// Spawn `bun run dev` in the repo's working directory, detached, with
	// stdout/stderr redirected to the per-repo log. nohup behavior: detach
	// from the terminal and write pid file.
	const fd = openSync(log, "a");
	const proc = Bun.spawn(["bun", "run", "dev"], {
		cwd: repo.path,
		stdout: fd,
		stderr: fd,
		stdin: "ignore",
	});

	writeFileSync(pid, String(proc.pid));

	// Don't await — the dev server is intended to run in the background.
	proc.unref();
	return "started";
}

async function stopRepo(repo: RepoEntry): Promise<"stopped" | "not-running" | "missing-path"> {
	if (!existsSync(repo.path)) return "missing-path";

	const pid = readPidFile(repo.name);
	const wasTracked = pid !== null && isAlive(pid);

	// Prefer `bun run dev:down` if defined — it knows how to clean up routes
	// (portless aliases, env state) that a plain SIGTERM wouldn't.
	let pkg: Record<string, unknown> | null = null;
	try {
		pkg = JSON.parse(readFileSync(join(repo.path, "package.json"), "utf8"));
	} catch {
		// no package.json — fall through to signal-based shutdown
	}
	const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
	if (scripts["dev:down"]) {
		const proc = Bun.spawn(["bun", "run", "dev:down"], {
			cwd: repo.path,
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
		});
		await proc.exited;
	}

	if (pid && isAlive(pid)) {
		try {
			process.kill(pid, "SIGTERM");
			// Give the process a couple of seconds to die before SIGKILL.
			for (let i = 0; i < 20; i++) {
				if (!isAlive(pid)) break;
				await Bun.sleep(100);
			}
			if (isAlive(pid)) {
				try {
					process.kill(pid, "SIGKILL");
				} catch {
					// ignore
				}
			}
		} catch {
			// process may have died between isAlive and kill
		}
	}

	clearPidFile(repo.name);
	return wasTracked ? "stopped" : "not-running";
}

function repoStatus(repo: RepoEntry): {
	name: string;
	state: "running" | "stopped";
	pid: number | null;
} {
	const pid = readPidFile(repo.name);
	if (pid && isAlive(pid)) return { name: repo.name, state: "running", pid };
	return { name: repo.name, state: "stopped", pid: null };
}

async function tailLog(name: string, lines = 50): Promise<number> {
	const p = logPath(name);
	if (!existsSync(p)) {
		console.error(`no log file for ${name} (expected ${p})`);
		return 1;
	}
	const r = Bun.spawnSync(["tail", "-n", String(lines), "-f", p], {
		stdout: "inherit",
		stderr: "inherit",
		stdin: "inherit",
	});
	return r.exitCode ?? 0;
}

// ---- Public entrypoint ----------------------------------------------------

export async function runRepos(action: string | undefined, rest: string[]): Promise<number> {
	const verb = action ?? "up";

	if (verb === "list") {
		const registry = loadRegistry();
		if (registry.repos.length === 0) {
			console.log("(no repos registered — try `nterprise repos add <path>`)");
			return 0;
		}
		for (const r of registry.repos) {
			console.log(`  ${r.name}\t${r.path}`);
		}
		return 0;
	}

	if (verb === "add") {
		const path = rest[0];
		if (!path) {
			console.error("usage: nterprise repos add <path> [name]");
			return 1;
		}
		const name = rest[1];
		try {
			const entry = addRepo(path, name);
			console.log(`✓ added ${entry.name} → ${entry.path}`);
			return 0;
		} catch (err) {
			console.error(`✗ ${(err as Error).message}`);
			return 1;
		}
	}

	if (verb === "remove") {
		const name = rest[0];
		if (!name) {
			console.error("usage: nterprise repos remove <name>");
			return 1;
		}
		const ok = removeRepo(name);
		console.log(ok ? `✓ removed ${name}` : `(no repo named ${name})`);
		return ok ? 0 : 1;
	}

	if (verb === "status") {
		const registry = loadRegistry();
		if (registry.repos.length === 0) {
			console.log("(no repos registered)");
			return 0;
		}
		for (const r of registry.repos) {
			const s = repoStatus(r);
			const tag = s.state === "running" ? `running (pid ${s.pid})` : "stopped";
			console.log(`  ${r.name}\t${tag}`);
		}
		return 0;
	}

	if (verb === "logs") {
		const name = rest[0];
		if (!name) {
			console.error("usage: nterprise repos logs <name>");
			return 1;
		}
		const repo = findRepo(name);
		if (!repo) {
			console.error(`no repo named ${name}`);
			return 1;
		}
		return tailLog(name);
	}

	if (verb === "up") {
		const registry = loadRegistry();
		if (registry.repos.length === 0) {
			console.log("(no repos registered — try `nterprise repos add <path>`)");
			return 0;
		}
		const filter = rest[0];
		const targets = filter ? registry.repos.filter((r) => r.name === filter) : registry.repos;
		if (targets.length === 0) {
			console.error(`no repo named ${filter}`);
			return 1;
		}
		console.log(`→ starting ${targets.length} repo(s)…\n`);
		for (const repo of targets) {
			const result = startRepo(repo);
			if (result === "started") console.log(`  ✓ ${repo.name} → ${logPath(repo.name)}`);
			else if (result === "already-running") console.log(`  · ${repo.name} (already running)`);
			else console.log(`  ✗ ${repo.name} (path missing: ${repo.path})`);
		}
		return 0;
	}

	if (verb === "down") {
		const registry = loadRegistry();
		if (registry.repos.length === 0) {
			console.log("(no repos registered)");
			return 0;
		}
		const filter = rest[0];
		const targets = filter ? registry.repos.filter((r) => r.name === filter) : registry.repos;
		if (targets.length === 0) {
			console.error(`no repo named ${filter}`);
			return 1;
		}
		console.log(`→ stopping ${targets.length} repo(s)…\n`);
		for (const repo of targets) {
			const result = await stopRepo(repo);
			console.log(`  ${result === "stopped" ? "✓" : "·"} ${repo.name} (${result})`);
		}
		return 0;
	}

	console.error(
		`unknown action: nterprise repos ${verb}. Try one of: up | down | status | logs | add | remove | list.`,
	);
	return 1;
}

// Re-export registry helpers + paths for tests + external scripting.
export { addRepo, findRepo, loadRegistry, REGISTRY_PATH, removeRepo, STATE_DIR, saveRegistry };
