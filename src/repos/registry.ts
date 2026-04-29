/**
 * Registry for `nterprise repos` — stored at ~/.config/nterprise/repos.json.
 *
 * Shape:
 *   { repos: [{ name: string, path: string }, ...] }
 *
 * `name` is the user-visible identifier (defaults to the directory basename
 * of `path` when adding). `path` is an absolute filesystem path to a project
 * root that exposes a `bun run dev` script.
 *
 * Lazy-created on first add. Missing or malformed files return an empty list
 * rather than throwing — `nterprise repos list` should always work.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";

export interface RepoEntry {
	name: string;
	path: string;
}

export interface RepoRegistry {
	repos: RepoEntry[];
}

export const CONFIG_DIR = resolve(homedir(), ".config", "nterprise");
export const REGISTRY_PATH = resolve(CONFIG_DIR, "repos.json");
export const STATE_DIR = resolve(CONFIG_DIR, "state");

/** Load the registry, defaulting to an empty list if missing/malformed. */
export function loadRegistry(path: string = REGISTRY_PATH): RepoRegistry {
	if (!existsSync(path)) return { repos: [] };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (
			parsed &&
			typeof parsed === "object" &&
			"repos" in parsed &&
			Array.isArray((parsed as RepoRegistry).repos)
		) {
			return {
				repos: (parsed as RepoRegistry).repos.filter(
					(r): r is RepoEntry =>
						typeof r === "object" &&
						r !== null &&
						typeof r.name === "string" &&
						typeof r.path === "string",
				),
			};
		}
		return { repos: [] };
	} catch {
		return { repos: [] };
	}
}

/** Persist the registry, creating parent dirs as needed. */
export function saveRegistry(registry: RepoRegistry, path: string = REGISTRY_PATH): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`);
}

/**
 * Add a repo to the registry. Returns the updated entry.
 * - If `name` is omitted, defaults to basename(path).
 * - If `path` is relative, resolved against cwd.
 * - If a repo with the same name already exists, replaces its path.
 * - Throws if path doesn't exist.
 */
export function addRepo(
	pathInput: string,
	nameInput?: string,
	registryPath: string = REGISTRY_PATH,
): RepoEntry {
	const absPath = isAbsolute(pathInput) ? pathInput : resolve(process.cwd(), pathInput);
	if (!existsSync(absPath)) {
		throw new Error(`path does not exist: ${absPath}`);
	}
	const name = nameInput ?? basename(absPath);
	if (!name) throw new Error("could not derive a name from path");

	const registry = loadRegistry(registryPath);
	const existing = registry.repos.find((r) => r.name === name);
	if (existing) {
		existing.path = absPath;
	} else {
		registry.repos.push({ name, path: absPath });
	}
	saveRegistry(registry, registryPath);
	return { name, path: absPath };
}

/**
 * Remove a repo by name. Returns true if removed, false if not found.
 */
export function removeRepo(name: string, registryPath: string = REGISTRY_PATH): boolean {
	const registry = loadRegistry(registryPath);
	const before = registry.repos.length;
	registry.repos = registry.repos.filter((r) => r.name !== name);
	if (registry.repos.length === before) return false;
	saveRegistry(registry, registryPath);
	return true;
}

/** Look up a single repo by name. */
export function findRepo(
	name: string,
	registryPath: string = REGISTRY_PATH,
): RepoEntry | undefined {
	return loadRegistry(registryPath).repos.find((r) => r.name === name);
}
