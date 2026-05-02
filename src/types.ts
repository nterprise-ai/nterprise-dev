/** Configuration for a single app in the dev stack */
export interface AppConfig {
	/** portless app name — becomes the subdomain: "community-stamps", "auctionomy-dashboard" */
	name: string;
	/** bun workspace filter — e.g. "@stamps/community", "@auctionomy/dashboard" */
	filter: string;
	/** Per-app dev command override. Defaults to DevServerConfig.devCommand */
	command?: string;
	/** Fallback port when running without portless (bun run dev directly) */
	defaultPort?: number;
	/**
	 * When true, this app registers at the bare TLD (config.tld) instead of name.tld.
	 * E.g. with tld="dev.adalati.com", root app registers at dev.adalati.com.
	 * Requires config.tld to be set.
	 */
	root?: boolean;
}

/**
 * Short-form app entry — a plain slug that gets expanded by normalizeConfig:
 *   "dashboard" → { name: "projectName-dashboard", filter: "@projectName/dashboard", defaultPort: 3000+i }
 */
export type AppEntry = AppConfig | string;

/** Optional tenant subdomain support */
export interface TenantConfig {
	/**
	 * portless app name to create aliases under.
	 * Accepts short form (e.g. "website") — expanded to "{projectName}-website" by normalizeConfig.
	 */
	app: string;
	/**
	 * Tenant slugs — either a static array or an async function that returns them.
	 *
	 * Static (config-based):
	 *   slugs: ["acme", "beta-corp"]
	 *
	 * Dynamic (e.g. from a database):
	 *   slugs: async () => db.query("SELECT slug FROM tenants")
	 */
	slugs: string[] | (() => Promise<string[]>);
	/**
	 * Tenant hostname layout relative to {@link DevServerConfig.tld}.
	 *
	 * - `"nested"` (default): `{slug}.{appName}.{tld}`
	 * - `"flat"`: `{slug}.{tld}` — wildcard-style tenant hosts (must match app routing)
	 */
	tenantHostMode?: "nested" | "flat";
	/**
	 * Build the portless alias name for a slug.
	 * Defaults to: (slug, app) => `${slug}.${app}`
	 * e.g. "acme" → "acme.auctionomy-website" → https://acme.auctionomy-website.test:1355
	 */
	slugToAlias?: (slug: string, app: string) => string;
}

export interface DevServerConfig {
	projectName: string;
	/** Accepts short slugs ("dashboard") or full AppConfig objects — see AppEntry */
	apps: AppEntry[];
	/** Env files to ensure exist. Auto-derived from string app entries if omitted. */
	envFiles?: string[];
	/** Root-level bun dev command to run per-app. Default: "dev" */
	devCommand?: string;
	/** Optional: register portless aliases for tenant subdomains after startup */
	tenants?: TenantConfig;
	/**
	 * Multi-segment TLD for config-driven mode, e.g. "dev.adalati.com".
	 * When set, nterprise manages the proxy lifecycle automatically:
	 * auto-starts proxy, writes TLD file, trusts CA, checks pf forwarding.
	 * When absent, legacy behavior applies.
	 */
	tld?: string;
	/**
	 * Whether to start the portless proxy with HTTPS support.
	 * Only used when tld is set. Default: false.
	 */
	https?: boolean;
	// Glob patterns to delete when `nterprise dev clean` is invoked. Framework-
	// agnostic replacement for per-repo cache-clean shell shims. Patterns are
	// resolved against the project root (cwd) via Bun.Glob; matches outside
	// cwd are skipped for safety.
	//
	// Examples (using line comments so the glob `*` characters don't collide
	// with JSDoc's `*/` terminator):
	//   Next.js : ["apps/<dir>/.next"]
	//   Vite    : ["apps/<dir>/dist", "apps/<dir>/.vite"]
	//   No-op   : [] or omit
	cleanPatterns?: string[];
}

/** Fully-resolved config — all apps are AppConfig objects, envFiles always present */
export interface ResolvedDevServerConfig extends Omit<DevServerConfig, "apps" | "envFiles"> {
	apps: AppConfig[];
	envFiles: string[];
	tld?: string;
	https?: boolean;
}

// ---------------------------------------------------------------------------
// Deprecated — slim-based types kept for backward compatibility
// ---------------------------------------------------------------------------

/** @deprecated Use TenantConfig */
export interface TenantSlimConfig {
	projectName: string;
	appName: string;
	defaultPort?: number;
	portEnvVar?: string;
}
