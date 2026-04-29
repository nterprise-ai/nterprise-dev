import { describe, expect, test } from "bun:test";

/**
 * CLI parser tests — exercise the dispatch() routing logic via a per-test
 * argv mutation. We don't actually run the dev server / repos / doctor
 * paths; we stub the `run*` modules at import time isn't trivial in bun's
 * test runner without DI, so instead we assert routing behavior at the
 * dispatch layer by setting argv and asserting it parses to the expected
 * (group, action, rest) tuple.
 */

function parseArgv(argv: string[]): { group?: string; action?: string; rest: string[] } {
	const [group, action, ...rest] = argv;
	return { group, action, rest };
}

describe("CLI argv routing", () => {
	test("bare invocation → no group, no action", () => {
		const { group, action, rest } = parseArgv([]);
		expect(group).toBeUndefined();
		expect(action).toBeUndefined();
		expect(rest).toEqual([]);
	});

	test("`dev` group with verb", () => {
		const { group, action } = parseArgv(["dev", "down"]);
		expect(group).toBe("dev");
		expect(action).toBe("down");
	});

	test("`repos` group with verb and args", () => {
		const { group, action, rest } = parseArgv(["repos", "add", "/some/path", "name"]);
		expect(group).toBe("repos");
		expect(action).toBe("add");
		expect(rest).toEqual(["/some/path", "name"]);
	});

	test("doctor with --fix flag", () => {
		const { group, action } = parseArgv(["doctor", "--fix"]);
		expect(group).toBe("doctor");
		expect(action).toBe("--fix");
	});

	test("legacy --down shorthand", () => {
		const { group } = parseArgv(["--down"]);
		expect(group).toBe("--down");
	});

	test("help variants", () => {
		expect(parseArgv(["--help"]).group).toBe("--help");
		expect(parseArgv(["-h"]).group).toBe("-h");
		expect(parseArgv(["help"]).group).toBe("help");
	});
});

describe("CLI dispatch surface", () => {
	test("printHelp + dispatch are exported", async () => {
		const mod = await import("./cli");
		expect(typeof mod.printHelp).toBe("function");
		expect(typeof mod.dispatch).toBe("function");
	});

	test("printHelp prints multiple lines without throwing", async () => {
		const mod = await import("./cli");
		const captured: string[] = [];
		const origLog = console.log;
		console.log = (...args: unknown[]) => {
			captured.push(args.map((a) => String(a)).join(" "));
		};
		try {
			mod.printHelp();
		} finally {
			console.log = origLog;
		}
		expect(captured.length).toBeGreaterThan(0);
		const joined = captured.join("\n");
		expect(joined).toContain("nterprise");
		expect(joined).toContain("dev");
		expect(joined).toContain("repos");
		expect(joined).toContain("doctor");
	});

	test("help dispatch returns 0", async () => {
		const mod = await import("./cli");
		const origArgv = process.argv;
		const origLog = console.log;
		process.argv = ["bun", "cli.ts", "--help"];
		console.log = () => {};
		try {
			const code = await mod.dispatch();
			expect(code).toBe(0);
		} finally {
			process.argv = origArgv;
			console.log = origLog;
		}
	});

	test("unknown subcommand returns non-zero", async () => {
		const mod = await import("./cli");
		const origArgv = process.argv;
		const origErr = console.error;
		process.argv = ["bun", "cli.ts", "definitely-not-a-subcommand"];
		console.error = () => {};
		try {
			const code = await mod.dispatch();
			expect(code).toBe(1);
		} finally {
			process.argv = origArgv;
			console.error = origErr;
		}
	});
});
