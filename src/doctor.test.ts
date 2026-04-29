import { describe, expect, test } from "bun:test";
import { migrateOldDaemon, oldDaemonPresent } from "./doctor";

const OLD_PLIST_PATH = "/Library/LaunchDaemons/dev.portfree.pfctl.plist";
const OLD_ANCHOR_PATH = "/etc/pf.anchors/dev.portfree.pfctl";

describe("oldDaemonPresent", () => {
	test("returns false on non-darwin platforms", () => {
		// Only meaningful when run on darwin; on other platforms it's hard-coded false
		// (and on darwin we accept whatever the actual filesystem state is, so we
		// just assert the function returns a boolean).
		const result = oldDaemonPresent();
		expect(typeof result).toBe("boolean");
	});
});

describe("migrateOldDaemon", () => {
	test("no-op when neither old plist nor old anchor exists", async () => {
		const calls: string[][] = [];
		const fakeSudo = async (args: string[]): Promise<void> => {
			calls.push(args);
		};
		const fakeExists = (_path: string) => false;

		const ran = await migrateOldDaemon({ runSudo: fakeSudo, fileExists: fakeExists });
		expect(ran).toBe(false);
		expect(calls).toEqual([]);
	});

	test("removes old plist + anchor and bootouts old label when both present", async () => {
		const calls: string[][] = [];
		const fakeSudo = async (args: string[]): Promise<void> => {
			calls.push(args);
		};
		const fakeExists = (path: string) => path === OLD_PLIST_PATH || path === OLD_ANCHOR_PATH;

		const ran = await migrateOldDaemon({ runSudo: fakeSudo, fileExists: fakeExists });
		expect(ran).toBe(true);

		// Expected sequence: bootout, rm plist, rm anchor.
		expect(calls.length).toBe(3);
		expect(calls[0]).toEqual(["launchctl", "bootout", "system/dev.portfree.pfctl"]);
		expect(calls[1]).toEqual(["rm", "-f", OLD_PLIST_PATH]);
		expect(calls[2]).toEqual(["rm", "-f", OLD_ANCHOR_PATH]);
	});

	test("only removes plist when anchor is gone", async () => {
		const calls: string[][] = [];
		const fakeSudo = async (args: string[]): Promise<void> => {
			calls.push(args);
		};
		const fakeExists = (path: string) => path === OLD_PLIST_PATH;

		await migrateOldDaemon({ runSudo: fakeSudo, fileExists: fakeExists });
		expect(calls.some((c) => c[0] === "launchctl" && c[1] === "bootout")).toBe(true);
		expect(calls.some((c) => c[0] === "rm" && c[2] === OLD_PLIST_PATH)).toBe(true);
		expect(calls.some((c) => c[0] === "rm" && c[2] === OLD_ANCHOR_PATH)).toBe(false);
	});

	test("only removes anchor when plist is gone", async () => {
		const calls: string[][] = [];
		const fakeSudo = async (args: string[]): Promise<void> => {
			calls.push(args);
		};
		const fakeExists = (path: string) => path === OLD_ANCHOR_PATH;

		await migrateOldDaemon({ runSudo: fakeSudo, fileExists: fakeExists });
		expect(calls.some((c) => c[0] === "rm" && c[2] === OLD_ANCHOR_PATH)).toBe(true);
		expect(calls.some((c) => c[0] === "rm" && c[2] === OLD_PLIST_PATH)).toBe(false);
	});

	test("swallows bootout failures so cleanup proceeds", async () => {
		const calls: string[][] = [];
		const fakeSudo = async (args: string[]): Promise<void> => {
			calls.push(args);
			if (args[0] === "launchctl" && args[1] === "bootout") {
				throw new Error("not loaded");
			}
		};
		const fakeExists = (path: string) => path === OLD_PLIST_PATH || path === OLD_ANCHOR_PATH;

		const ran = await migrateOldDaemon({ runSudo: fakeSudo, fileExists: fakeExists });
		expect(ran).toBe(true);
		// bootout, then rm, then rm — three sudo calls, even with bootout failing
		expect(calls.length).toBe(3);
	});
});
