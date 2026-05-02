import type { AppConfig, TenantConfig } from "./types";

/**
 * Compute the Portless hostname for a tenant slug.
 *
 * - **Nested** (default): `{slug}.{appName}.{tld}` — shares the website app's DNS prefix.
 * - **Flat** (`tenantHostMode: "flat"`): `{slug}.{tld}` — e.g. wildcard tenant sites on `*.dev.product.com`.
 */
export function computeTenantHostname(
	slug: string,
	tenants: TenantConfig,
	app: AppConfig,
	tld?: string,
): string {
	if (!tld) {
		const aliasBase = tenants.slugToAlias
			? tenants.slugToAlias(slug, app.name)
			: `${slug}.${app.name}`;
		return aliasBase;
	}
	if (tenants.tenantHostMode === "flat") {
		return `${slug}.${tld}`;
	}
	const aliasBase = tenants.slugToAlias
		? tenants.slugToAlias(slug, app.name)
		: `${slug}.${app.name}`;
	return `${aliasBase}.${tld}`;
}
