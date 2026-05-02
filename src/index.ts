/**
 * @nterprise-ai/dev — top-level public API.
 *
 * Mirrors the surface that `@sharadkumar/web/portfree` used to expose.
 * Sub-exports `./themes` and `./website-builder` are NOT re-exported here.
 */

export { createDevDown, createDevServer, normalizeConfig } from "./dev-server";
export { computeTenantHostname } from "./tenant-hostname";
export { ensureEnvFiles } from "./env-files";
export type { PortlessRoute } from "./portless";
export {
	getPortlessAppPort,
	hasPortless,
	portlessAlias,
	portlessAliasRemove,
	portlessList,
} from "./portless";
// utilities
export { findFreePort } from "./ports";
// slim — deprecated, kept for backward compatibility
export { hasSlim, slimCleanup, slimStart } from "./slim";
export {
	createTenantCli,
	deregisterTenantDomain,
	registerAllTenants,
	registerTenantDomain,
	tenantAliasName,
	tenantUrl,
} from "./tenant";
export {
	createTenantSlimCli,
	deregisterTenantDomain as deregisterTenantDomainSlim,
	registerTenantDomain as registerTenantDomainSlim,
	slimDomainName,
	tenantUrl as tenantUrlSlim,
} from "./tenant-slim";
export type {
	AppConfig,
	AppEntry,
	DevServerConfig,
	ResolvedDevServerConfig,
	TenantConfig,
	TenantSlimConfig,
} from "./types";
export { findMainRepoRoot, getWorktreeId } from "./worktree";
