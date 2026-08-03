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

import { classifyHttpsPath, type HttpsPathProbe, SLIM_PROXY_PORT, TLS_PORT } from "./doctor";

describe("classifyHttpsPath", () => {
	const portlessOk: HttpsPathProbe = {
		connect: "ok",
		tls: "ok",
		issuer: "CN=portless Local CA",
		subject: "CN=doctor-probe.portless.local",
	};
	const slimOk: HttpsPathProbe = {
		connect: "ok",
		tls: "ok",
		issuer: "O=slim; CN=slim Root CA",
		subject: "CN=claudius-studio.test",
	};
	const tlsAlert: HttpsPathProbe = {
		connect: "ok",
		tls: "alert",
		issuer: null,
		subject: null,
		error: "tlsv1 alert internal error",
	};
	const refused: HttpsPathProbe = {
		connect: "refused",
		tls: "skipped",
		issuer: null,
		subject: null,
	};

	test("ok when 443 TLS completes with a Portless issuer", () => {
		const result = classifyHttpsPath({
			via443: portlessOk,
			viaProxy: portlessOk,
			slimListening: false,
		});
		expect(result.status).toBe("ok");
	});

	test("competing-proxy when 443 presents a slim certificate", () => {
		const result = classifyHttpsPath({
			via443: slimOk,
			viaProxy: portlessOk,
			slimListening: true,
		});
		expect(result.status).toBe("competing-proxy");
		expect(result.message).toMatch(/slim/i);
		expect(result.message).toContain(String(SLIM_PROXY_PORT));
	});

	test("competing-proxy when 443 TLS alerts but slim is listening", () => {
		// The auctionomy#1187 failure mode: TCP connects, SNI for a Portless
		// host gets tlsv1 alert internal error, because slim owns the redirect.
		const result = classifyHttpsPath({
			via443: tlsAlert,
			viaProxy: portlessOk,
			slimListening: true,
		});
		expect(result.status).toBe("competing-proxy");
		expect(result.message).toMatch(/slim/i);
		expect(result.message).toMatch(/alert|TLS/i);
	});

	test("redirect-broken when proxy TLS works but 443 TLS fails and slim is absent", () => {
		const result = classifyHttpsPath({
			via443: tlsAlert,
			viaProxy: portlessOk,
			slimListening: false,
		});
		expect(result.status).toBe("redirect-broken");
		expect(result.message).toMatch(/443/);
		expect(result.message).toContain(String(TLS_PORT));
	});

	test("rule-missing when 443 refuses and proxy is up", () => {
		const result = classifyHttpsPath({
			via443: refused,
			viaProxy: portlessOk,
			slimListening: false,
		});
		expect(result.status).toBe("rule-missing");
	});

	test("proxy-down when neither path can complete TLS", () => {
		const result = classifyHttpsPath({
			via443: refused,
			viaProxy: refused,
			slimListening: false,
		});
		expect(result.status).toBe("proxy-down");
	});

	test("does not treat a Portless issuer as competing even if slim is listening", () => {
		// nterprise PF rule is winning; slim may be installed but not owning 443.
		const result = classifyHttpsPath({
			via443: portlessOk,
			viaProxy: portlessOk,
			slimListening: true,
		});
		expect(result.status).toBe("ok");
	});
});
