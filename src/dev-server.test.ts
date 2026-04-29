import { describe, expect, test } from "bun:test";
import { normalizeConfig } from "./dev-server";

describe("normalizeConfig", () => {
	describe("with non-empty projectName", () => {
		test("expands string app to projectName-app", () => {
			const result = normalizeConfig({
				projectName: "adalati",
				apps: ["dashboard"],
				devCommand: "dev",
			});
			expect(result.apps[0].name).toBe("adalati-dashboard");
			expect(result.apps[0].filter).toBe("@adalati/dashboard");
		});

		test("expands short tenant app name to projectName-tenant", () => {
			const result = normalizeConfig({
				projectName: "adalati",
				apps: [],
				devCommand: "dev",
				tenants: { app: "website", slugs: [] },
			});
			expect(result.tenants?.app).toBe("adalati-website");
		});

		test("leaves tenant app name unchanged if it already contains a hyphen", () => {
			const result = normalizeConfig({
				projectName: "adalati",
				apps: [],
				devCommand: "dev",
				tenants: { app: "adalati-website", slugs: [] },
			});
			expect(result.tenants?.app).toBe("adalati-website");
		});
	});

	describe("with empty projectName", () => {
		test("expands string app to just the app name (no leading hyphen)", () => {
			const result = normalizeConfig({
				projectName: "",
				apps: ["dashboard"],
				devCommand: "dev",
			});
			expect(result.apps[0].name).toBe("dashboard");
			expect(result.apps[0].filter).toBe("dashboard");
		});

		test("expands short tenant app name without leading hyphen", () => {
			const result = normalizeConfig({
				projectName: "",
				apps: [],
				devCommand: "dev",
				tenants: { app: "website", slugs: [] },
			});
			expect(result.tenants?.app).toBe("website");
		});

		test("leaves tenant app name unchanged if it already contains a hyphen", () => {
			const result = normalizeConfig({
				projectName: "",
				apps: [],
				devCommand: "dev",
				tenants: { app: "my-website", slugs: [] },
			});
			expect(result.tenants?.app).toBe("my-website");
		});
	});

	describe("tld and https pass-through", () => {
		test("passes tld through to resolved config", () => {
			const result = normalizeConfig({
				projectName: "",
				apps: [],
				tld: "dev.adalati.com",
			});
			expect(result.tld).toBe("dev.adalati.com");
		});

		test("passes https through to resolved config", () => {
			const result = normalizeConfig({
				projectName: "",
				apps: [],
				tld: "dev.adalati.com",
				https: true,
			});
			expect(result.https).toBe(true);
		});

		test("tld and https are undefined when not provided", () => {
			const result = normalizeConfig({
				projectName: "adalati",
				apps: [],
			});
			expect(result.tld).toBeUndefined();
			expect(result.https).toBeUndefined();
		});
	});

	describe("root app pass-through", () => {
		test("preserves root: true on object-form AppConfig", () => {
			const result = normalizeConfig({
				projectName: "",
				apps: [{ name: "web", filter: "@adalati/web", defaultPort: 3000, root: true }],
			});
			expect(result.apps[0].root).toBe(true);
		});

		test("root is undefined on string-expanded apps", () => {
			const result = normalizeConfig({
				projectName: "adalati",
				apps: ["dashboard"],
			});
			expect(result.apps[0].root).toBeUndefined();
		});
	});
});
