import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configurePfConf, PF_DISPATCH, PF_HELPER, PF_LOAD, PF_PLIST } from "./pf-service";

const base = `# Operator configuration\nscrub-anchor "com.apple/*"\nnat-anchor "com.apple/*"\nrdr-anchor "com.apple/*"\nrdr-anchor "vpn"\ndummynet-anchor "com.apple/*"\nanchor "com.apple/*"\nload anchor "vpn" from "/etc/pf.anchors/vpn"\n`;

describe("PF configuration migration", () => {
	test("idempotent install and removal preserve all operator configuration", () => {
		const configured = configurePfConf(base);
		expect(configurePfConf(configured)).toBe(configured);
		expect(configurePfConf(configured, false)).toBe(base);
		expect(configured.indexOf(PF_DISPATCH)).toBeLessThan(configured.indexOf('rdr-anchor "vpn"'));
		expect(configured).toContain(PF_LOAD);
	});
	test("unknown configurations fail instead of guessing PF rule order", () => {
		expect(() => configurePfConf("# custom empty configuration\n")).toThrow("Unrecognized");
	});
	test("launchd owns the schedule and executes only the installed helper", () => {
		expect(PF_PLIST).toContain("<key>StartInterval</key><integer>30</integer>");
		expect(PF_PLIST).toContain("/Library/PrivilegedHelperTools/dev.nterprise.pfctl");
		expect(PF_PLIST).not.toContain("bun");
	});
});

// Execute the actual /bin/sh helper against a fake pfctl. All decision-making
// remains in the shipped script; only its absolute pfctl executable is replaced.
function reconcile(opts: {
	missing?: boolean;
	disabled?: boolean;
	dispatcher?: boolean;
	queryFailure?: boolean;
}) {
	const dir = mkdtempSync(join(tmpdir(), "pf-reconcile-test-"));
	try {
		const fake = join(dir, "pfctl");
		const calls = join(dir, "calls");
		writeFileSync(
			fake,
			`#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\ncase "$*" in
  '-sn') ${opts.queryFailure ? "exit 1" : `echo '${opts.dispatcher === false ? 'rdr-anchor "vpn" all' : `${PF_DISPATCH} all`}'`} ;;
  '-a dev.nterprise -sn') ${opts.missing ? ":" : "echo 'rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port = 443 -> 127.0.0.1 port 1355'"} ;;
  '-s info') echo 'Status: ${opts.disabled ? "Disabled" : "Enabled"} for 0 days' ;;
esac\n`,
			{ mode: 0o755 },
		);
		const script = join(dir, "reconcile");
		writeFileSync(script, PF_HELPER.replaceAll("/sbin/pfctl", fake));
		const result = Bun.spawnSync(["/bin/sh", script]);
		return { code: result.exitCode, calls: readFileSync(calls, "utf8").trim().split("\n") };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("unattended recovery", () => {
	test("healthy state performs only reads", () => {
		expect(reconcile({})).toEqual({ code: 0, calls: ["-sn", "-a dev.nterprise -sn", "-s info"] });
	});
	test("lost rule reloads only our anchor", () => {
		const result = reconcile({ missing: true });
		expect(result.code).toBe(0);
		expect(result.calls).toContain("-a dev.nterprise -f /etc/pf.anchors/dev.nterprise.pfctl");
		expect(result.calls.some((call) => call.startsWith("-f") || call.includes("-F"))).toBe(false);
	});
	test("disabled PF is enabled without adding enable references", () => {
		const result = reconcile({ disabled: true });
		expect(result.code).toBe(0);
		expect(result.calls.at(-1)).toBe("-e");
		expect(result.calls).not.toContain("-E");
	});
	test("both missing and disabled recover in one invocation", () => {
		const result = reconcile({ missing: true, disabled: true });
		expect(result.code).toBe(0);
		expect(result.calls).toHaveLength(5);
	});
	test("missing global dispatcher fails without overwriting foreign rules", () => {
		expect(reconcile({ dispatcher: false })).toEqual({ code: 1, calls: ["-sn"] });
	});
	test("failed PF inspection never triggers a blind reload", () => {
		expect(reconcile({ queryFailure: true })).toEqual({ code: 1, calls: ["-sn"] });
	});
});
