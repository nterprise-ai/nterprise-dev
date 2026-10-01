import { describe, expect, test } from "bun:test";
import {
	parseRoutesTable,
	RoutesTableUnreadableError,
	removeHostnames,
	removeOwnedEntries,
	sameRoutes,
	upsertEntries,
} from "./routes-table";

const PATH = "/state/routes.json";

const otherRepo = { hostname: "dev.adalati.com", port: 6010, pid: 0 };
const dashboard = { hostname: "dashboard.dev.example.com", port: 5010, pid: 111 };

describe("parseRoutesTable", () => {
	test("a missing file is an empty table", () => {
		expect(parseRoutesTable(null, PATH)).toEqual([]);
	});

	test("an empty file is unreadable, not empty (a torn in-place write)", () => {
		expect(() => parseRoutesTable("", PATH)).toThrow(RoutesTableUnreadableError);
	});

	test("truncated JSON is unreadable, not empty", () => {
		const torn = JSON.stringify([otherRepo, dashboard], null, 2).slice(0, 40);
		expect(() => parseRoutesTable(torn, PATH)).toThrow(RoutesTableUnreadableError);
	});

	test("a non-array is unreadable", () => {
		expect(() => parseRoutesTable('{"hostname":"x"}', PATH)).toThrow(/not a JSON array/);
	});

	test("the error names the file and the remedy", () => {
		expect(() => parseRoutesTable("[", PATH)).toThrow(/routes\.json\.corrupt/);
		expect(() => parseRoutesTable("[", PATH)).toThrow(PATH);
	});

	test("drops malformed entries, keeps valid ones", () => {
		const raw = JSON.stringify([otherRepo, { hostname: 1 }, null, dashboard]);
		expect(parseRoutesTable(raw, PATH)).toEqual([otherRepo, dashboard]);
	});
});

describe("upsertEntries", () => {
	test("replaces this hostname and keeps every other writer's routes", () => {
		const next = upsertEntries([otherRepo, dashboard], [{ ...dashboard, pid: 222 }]);
		expect(next).toEqual([otherRepo, { ...dashboard, pid: 222 }]);
	});
});

describe("removeHostnames", () => {
	test("removes by hostname regardless of owner", () => {
		expect(removeHostnames([otherRepo, dashboard], [dashboard.hostname])).toEqual([otherRepo]);
	});
});

describe("removeOwnedEntries", () => {
	test("removes the exact entry this process registered", () => {
		expect(removeOwnedEntries([otherRepo, dashboard], [dashboard])).toEqual([otherRepo]);
	});

	test("keeps a sibling checkout's newer entry for the same hostname", () => {
		const sibling = { ...dashboard, pid: 333 };
		expect(removeOwnedEntries([otherRepo, sibling], [dashboard])).toEqual([otherRepo, sibling]);
	});

	test("keeps a same-pid alias re-pointed at another port", () => {
		const alias = { hostname: "demo.dev.example.com", port: 5011, pid: 0 };
		const repointed = { ...alias, port: 5111 };
		expect(removeOwnedEntries([repointed], [alias])).toEqual([repointed]);
	});
});

describe("sameRoutes", () => {
	test("detects a no-op rewrite", () => {
		expect(sameRoutes([otherRepo, dashboard], [otherRepo, dashboard])).toBe(true);
		expect(sameRoutes([otherRepo, dashboard], [dashboard, otherRepo])).toBe(false);
	});
});
