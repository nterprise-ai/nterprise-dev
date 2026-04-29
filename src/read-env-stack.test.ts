import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvStack, parseEnvFile } from "./read-env-stack";

describe("parseEnvFile", () => {
	test("parses plain KEY=value pairs", () => {
		const out = parseEnvFile("FOO=bar\nBAZ=qux");
		expect(out).toEqual({ FOO: "bar", BAZ: "qux" });
	});

	test("ignores blank lines and full-line comments", () => {
		const out = parseEnvFile(
			"\n# a comment\nFOO=bar\n\n  # indented comment is treated as line\nBAZ=qux\n",
		);
		expect(out).toEqual({ FOO: "bar", BAZ: "qux" });
	});

	test("strips matched single and double quotes", () => {
		const out = parseEnvFile(`A="hello world"\nB='with spaces'\nC=plain`);
		expect(out).toEqual({ A: "hello world", B: "with spaces", C: "plain" });
	});

	test("preserves unmatched quotes (treats as literal)", () => {
		const out = parseEnvFile(`A="missing\nB=ok`);
		expect(out).toEqual({ A: '"missing', B: "ok" });
	});

	test("drops `export ` prefix", () => {
		const out = parseEnvFile("export FOO=bar\nexport BAZ=qux");
		expect(out).toEqual({ FOO: "bar", BAZ: "qux" });
	});

	test("rejects malformed key names", () => {
		const out = parseEnvFile("1FOO=bad\nFOO BAR=bad\n=bad\nGOOD=ok");
		expect(out).toEqual({ GOOD: "ok" });
	});

	test("trims whitespace around key but not inside quoted values", () => {
		const out = parseEnvFile(`  FOO  =  "  spaced  "\nBAR= unquoted_trims`);
		expect(out).toEqual({ FOO: "  spaced  ", BAR: "unquoted_trims" });
	});

	test("empty file → empty record", () => {
		expect(parseEnvFile("")).toEqual({});
		expect(parseEnvFile("\n\n\n")).toEqual({});
	});
});

describe("loadEnvStack", () => {
	let workdir: string;
	let savedEnv: Record<string, string | undefined>;

	const TRACKED_KEYS = [
		"NTERPRISE_TEST_NEW_KEY",
		"NTERPRISE_TEST_PRESET_KEY",
		"NTERPRISE_TEST_EMPTY_KEY",
	];

	beforeEach(() => {
		workdir = mkdtempSync(join(tmpdir(), "nterprise-env-test-"));
		savedEnv = {};
		for (const k of TRACKED_KEYS) {
			savedEnv[k] = process.env[k];
			delete process.env[k];
		}
	});

	afterEach(() => {
		rmSync(workdir, { recursive: true, force: true });
		for (const k of TRACKED_KEYS) {
			if (savedEnv[k] === undefined) {
				delete process.env[k];
			} else {
				process.env[k] = savedEnv[k];
			}
		}
	});

	test("no .env.dev → loaded=false, no env mutation", () => {
		const r = loadEnvStack(workdir);
		expect(r.loaded).toBe(false);
		expect(r.applied).toBe(0);
		expect(process.env.NTERPRISE_TEST_NEW_KEY).toBeUndefined();
	});

	test("applies defaults only when key is unset", () => {
		writeFileSync(
			join(workdir, ".env.dev"),
			"NTERPRISE_TEST_NEW_KEY=fresh\nNTERPRISE_TEST_PRESET_KEY=will_be_skipped\n",
		);
		process.env.NTERPRISE_TEST_PRESET_KEY = "real_value";

		const r = loadEnvStack(workdir);
		expect(r.loaded).toBe(true);
		expect(r.applied).toBe(1);
		expect(r.skipped).toBe(1);
		expect(process.env.NTERPRISE_TEST_NEW_KEY).toBe("fresh");
		expect(process.env.NTERPRISE_TEST_PRESET_KEY).toBe("real_value");
	});

	test("treats empty string env as unset (overrides with default)", () => {
		writeFileSync(join(workdir, ".env.dev"), "NTERPRISE_TEST_EMPTY_KEY=default\n");
		process.env.NTERPRISE_TEST_EMPTY_KEY = "";

		const r = loadEnvStack(workdir);
		expect(r.applied).toBe(1);
		expect(process.env.NTERPRISE_TEST_EMPTY_KEY).toBe("default");
	});
});
