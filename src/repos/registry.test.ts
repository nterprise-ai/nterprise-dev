import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addRepo, findRepo, loadRegistry, removeRepo, saveRegistry } from "./registry";

describe("registry", () => {
	let workdir: string;
	let registryPath: string;
	let repoPath: string;

	beforeEach(() => {
		workdir = mkdtempSync(join(tmpdir(), "nterprise-registry-test-"));
		registryPath = join(workdir, "repos.json");
		repoPath = join(workdir, "myrepo");
		mkdirSync(repoPath, { recursive: true });
	});

	afterEach(() => {
		rmSync(workdir, { recursive: true, force: true });
	});

	describe("loadRegistry", () => {
		test("returns empty list when file does not exist", () => {
			expect(loadRegistry(registryPath)).toEqual({ repos: [] });
		});

		test("returns empty list on malformed JSON", () => {
			writeFileSync(registryPath, "not json");
			expect(loadRegistry(registryPath)).toEqual({ repos: [] });
		});

		test("returns empty list when shape is wrong", () => {
			writeFileSync(registryPath, JSON.stringify({ wrong: "shape" }));
			expect(loadRegistry(registryPath)).toEqual({ repos: [] });
		});

		test("filters out malformed entries", () => {
			writeFileSync(
				registryPath,
				JSON.stringify({
					repos: [
						{ name: "a", path: "/a" },
						{ name: 123, path: "/b" },
						{ name: "c" },
						{ name: "d", path: "/d" },
					],
				}),
			);
			const r = loadRegistry(registryPath);
			expect(r.repos).toEqual([
				{ name: "a", path: "/a" },
				{ name: "d", path: "/d" },
			]);
		});
	});

	describe("addRepo / findRepo / removeRepo", () => {
		test("addRepo writes a new entry, findRepo reads it back", () => {
			const entry = addRepo(repoPath, undefined, registryPath);
			expect(entry.name).toBe("myrepo");
			expect(entry.path).toBe(repoPath);

			expect(findRepo("myrepo", registryPath)).toEqual({
				name: "myrepo",
				path: repoPath,
			});
		});

		test("addRepo defaults name to basename", () => {
			const entry = addRepo(repoPath, undefined, registryPath);
			expect(entry.name).toBe("myrepo");
		});

		test("addRepo accepts explicit name", () => {
			const entry = addRepo(repoPath, "alias", registryPath);
			expect(entry.name).toBe("alias");
		});

		test("addRepo replaces path if name already registered", () => {
			addRepo(repoPath, "alias", registryPath);

			const otherPath = join(workdir, "other");
			mkdirSync(otherPath);
			addRepo(otherPath, "alias", registryPath);

			const r = loadRegistry(registryPath);
			expect(r.repos).toEqual([{ name: "alias", path: otherPath }]);
		});

		test("addRepo throws for non-existent path", () => {
			expect(() => addRepo(join(workdir, "nope"), "alias", registryPath)).toThrow();
		});

		test("removeRepo removes by name and returns true", () => {
			addRepo(repoPath, "alias", registryPath);
			expect(removeRepo("alias", registryPath)).toBe(true);
			expect(loadRegistry(registryPath).repos).toEqual([]);
		});

		test("removeRepo returns false for missing name", () => {
			expect(removeRepo("nope", registryPath)).toBe(false);
		});

		test("findRepo returns undefined for missing name", () => {
			expect(findRepo("nope", registryPath)).toBeUndefined();
		});
	});

	describe("saveRegistry", () => {
		test("creates parent dir when missing", () => {
			const nested = join(workdir, "a", "b", "c", "repos.json");
			saveRegistry({ repos: [{ name: "n", path: "/p" }] }, nested);
			const back = JSON.parse(readFileSync(nested, "utf8"));
			expect(back).toEqual({ repos: [{ name: "n", path: "/p" }] });
		});
	});
});
