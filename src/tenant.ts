/**
 * Tenant subdomain management via portless aliases.
 *
 * Registers portless alias routes so tenant subdomains proxy to the same
 * backend as the primary app:
 *   acme.auctionomy-website.test:1355  →  localhost:<website-port>
 *
 * For .test TLD: run `sudo portless hosts sync` after registration to add
 * the new aliases to /etc/hosts (needed for DNS resolution).
 * For .localhost TLD: wildcard subdomains resolve natively — no hosts sync needed.
 */

import { getPortlessAppPort, portlessAlias, portlessAliasRemove } from "./portless";
import type { TenantConfig } from "./types";

/** Build the portless alias name for a tenant slug */
export function tenantAliasName(slug: string, config: TenantConfig): string {
	const build = config.slugToAlias ?? ((s, app) => `${s}.${app}`);
	return build(slug, config.app);
}

/** Full portless URL for a tenant (informational, uses current proxy TLD) */
export function tenantUrl(slug: string, config: TenantConfig, tld = "test", port = 1355): string {
	return `https://${tenantAliasName(slug, config)}.${tld}:${port}`;
}

/**
 * Register a portless alias for a tenant slug.
 * Looks up the running app port from `portless list`, retrying until the
 * app process appears (portless may take a moment to register after spawn).
 *
 * @param env Optional environment overrides forwarded to portless (e.g. `{ HOME: projectHome }`)
 */
export async function registerTenantDomain(
	slug: string,
	config: TenantConfig,
	{
		retries = 6,
		retryDelayMs = 2_000,
		env,
	}: { retries?: number; retryDelayMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<boolean> {
	let port: number | null = null;
	for (let attempt = 0; attempt <= retries; attempt++) {
		port = await getPortlessAppPort(config.app);
		if (port) break;
		if (attempt < retries) {
			await Bun.sleep(retryDelayMs);
		}
	}

	if (!port) {
		console.log(
			`   [tenant] Cannot find port for "${config.app}" after ${retries + 1} attempts — is dev server running?`,
		);
		return false;
	}

	const alias = tenantAliasName(slug, config);
	await portlessAlias(alias, port, env);
	console.log(`   [tenant] ✓ ${alias} → localhost:${port}`);
	return true;
}

/**
 * Remove a portless alias for a tenant slug.
 */
export async function deregisterTenantDomain(slug: string, config: TenantConfig): Promise<void> {
	const alias = tenantAliasName(slug, config);
	await portlessAliasRemove(alias);
	console.log(`   [tenant] removed ${alias}`);
}

/**
 * Register aliases for all slugs in config.slugs.
 * Called automatically by createDevServer after a startup delay.
 *
 * @param env Optional environment overrides forwarded to portless (e.g. `{ HOME: projectHome }`)
 */
export async function registerAllTenants(
	config: TenantConfig,
	env?: NodeJS.ProcessEnv,
): Promise<void> {
	let slugs: string[] = [];
	try {
		const raw = config.slugs;
		slugs = Array.isArray(raw) ? raw : await raw();
	} catch (err) {
		console.log(`   [tenant] slugs() failed: ${(err as Error).message}`);
		return;
	}

	if (!slugs.length) return;

	console.log(`\n[tenant] Registering ${slugs.length} tenant alias(es)...`);
	for (const slug of slugs) {
		await registerTenantDomain(slug, config, { env });
	}
	console.log("[tenant] Done.\n");
}

/**
 * CLI entry point for per-tenant alias management.
 * Usage:
 *   bun scripts/tenant/nterprise.ts --slug <slug>
 *   bun scripts/tenant/nterprise.ts --slug <slug> --remove
 */
export function createTenantCli(config: TenantConfig): void {
	cliMain(config).catch((err) => {
		console.error("Failed:", err);
		process.exit(1);
	});
}

async function cliMain(config: TenantConfig): Promise<void> {
	const args = process.argv.slice(2);
	const slugIdx = args.indexOf("--slug");
	const slug = slugIdx !== -1 ? args[slugIdx + 1] : null;
	const remove = args.includes("--remove");

	if (!slug) {
		console.log("Usage:");
		console.log("  --slug <slug>           register alias");
		console.log("  --slug <slug> --remove  deregister alias");
		process.exit(1);
	}

	if (remove) {
		await deregisterTenantDomain(slug, config);
	} else {
		await registerTenantDomain(slug, config);
	}
}
