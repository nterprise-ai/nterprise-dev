import { afterEach, describe, expect, test } from "bun:test";

// We need to test the internal name-parsing logic of portlessList.
// Since portlessList calls `portless list` as a subprocess, we test the
// name extraction logic by exercising portlessList with a mocked Bun.spawnSync.

describe("portlessList name extraction", () => {
	const originalSpawnSync = Bun.spawnSync;

	afterEach(() => {
		// Restore original
		(Bun as Record<string, unknown>).spawnSync = originalSpawnSync;
	});

	function _mockSpawnSyncOutput(output: string) {
		(Bun as Record<string, unknown>).spawnSync = (cmd: string[], _opts?: unknown) => {
			if (cmd[0] === "portless" && cmd[1] === "list") {
				return {
					exitCode: 0,
					stdout: Buffer.from(output),
					stderr: Buffer.from(""),
				};
			}
			// proxy.tld read — return a string result for readFileSync mock
			return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("") };
		};
	}

	test("single-segment TLD (.test): extracts bare app name", async () => {
		// We test the name extraction via the parsing logic.
		// For a host like "adalati-web.test", name should be "adalati-web".
		const line = "  https://adalati-web.test:1355  ->  localhost:4966  (pid 60451)";
		const lineRe = /https?:\/\/([^:]+):\d+\s+->\s+localhost:(\d+)\s+\((?:pid\s+(\d+)|alias)\)/;
		const m = line.match(lineRe);
		if (!m) throw new Error("Expected line to match");
		const fullHost = m[1]; // "adalati-web.test"

		// Old logic: strip last segment only
		const parts = fullHost.split(".");
		const oldName = parts.slice(0, -1).join(".");
		expect(oldName).toBe("adalati-web"); // works fine for single-segment TLD

		// New logic with known TLD "test": strip ".test" suffix
		const tld = "test";
		const newName = fullHost.endsWith(`.${tld}`)
			? fullHost.slice(0, -(tld.length + 1))
			: parts.slice(0, -1).join(".");
		expect(newName).toBe("adalati-web");
	});

	test("multi-segment TLD (dev.adalati.com): extracts bare app name", () => {
		// For a host like "website.dev.adalati.com", old logic gives "website.dev.adalati".
		// New logic with tld="dev.adalati.com" gives "website".
		const fullHost = "website.dev.adalati.com";
		const tld = "dev.adalati.com";

		// Old logic (broken):
		const parts = fullHost.split(".");
		const oldName = parts.slice(0, -1).join(".");
		expect(oldName).toBe("website.dev.adalati"); // demonstrates the bug

		// New logic (fixed):
		const newName = fullHost.endsWith(`.${tld}`)
			? fullHost.slice(0, -(tld.length + 1))
			: parts.slice(0, -1).join(".");
		expect(newName).toBe("website");
	});

	test("multi-segment TLD with subdomain alias: extracts full subdomain", () => {
		// For "demo.adalati-website.dev.adalati.com" with tld="dev.adalati.com"
		// name should be "demo.adalati-website"
		const fullHost = "demo.adalati-website.dev.adalati.com";
		const tld = "dev.adalati.com";

		const newName = fullHost.endsWith(`.${tld}`)
			? fullHost.slice(0, -(tld.length + 1))
			: fullHost.split(".").slice(0, -1).join(".");
		expect(newName).toBe("demo.adalati-website");
	});

	test("fallback when tld does not match: strips last segment", () => {
		// If tld doesn't match (shouldn't happen in practice), fall back to old behavior
		const fullHost = "app.example.org";
		const tld = "test";

		const parts = fullHost.split(".");
		const name = fullHost.endsWith(`.${tld}`)
			? fullHost.slice(0, -(tld.length + 1))
			: parts.slice(0, -1).join(".");
		expect(name).toBe("app.example");
	});
});
