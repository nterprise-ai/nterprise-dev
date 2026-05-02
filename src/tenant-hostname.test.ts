import { describe, expect, test } from "bun:test";
import { computeTenantHostname } from "./tenant-hostname";
import type { AppConfig } from "./types";

const websiteApp: AppConfig = {
	name: "myproj-website",
	filter: "@myproj/website",
	defaultPort: 5011,
};

describe("computeTenantHostname", () => {
	test("nested default with multi-segment tld", () => {
		const tenants = { app: "website", slugs: [] as string[] };
		expect(computeTenantHostname("acme", tenants, websiteApp, "dev.example.com")).toBe(
			"acme.myproj-website.dev.example.com",
		);
	});

	test("flat mode uses slug.tld only", () => {
		const tenants = {
			app: "website",
			slugs: [] as string[],
			tenantHostMode: "flat" as const,
		};
		expect(computeTenantHostname("acme", tenants, websiteApp, "dev.example.com")).toBe(
			"acme.dev.example.com",
		);
	});

	test("slugToAlias overrides nested alias base", () => {
		const tenants = {
			app: "website",
			slugs: [] as string[],
			slugToAlias: (slug: string, _app: string) => `x-${slug}`,
		};
		expect(computeTenantHostname("acme", tenants, websiteApp, "dev.example.com")).toBe(
			"x-acme.dev.example.com",
		);
	});

	test("without tld returns alias label only", () => {
		const tenants = { app: "website", slugs: [] as string[] };
		expect(computeTenantHostname("acme", tenants, websiteApp)).toBe("acme.myproj-website");
	});

	test("flat mode without tld falls back like nested (slug.app)", () => {
		const tenants = {
			app: "website",
			slugs: [] as string[],
			tenantHostMode: "flat" as const,
		};
		expect(computeTenantHostname("acme", tenants, websiteApp)).toBe("acme.myproj-website");
	});
});
