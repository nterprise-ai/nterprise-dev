/**
 * Pure rules for rewriting Portless's `routes.json`.
 *
 * The file is shared: Portless itself, every checkout's `createDevServer`, and
 * — when one HTTPS proxy fronts several repositories — other repositories'
 * launchers all rewrite the same table. Two rules keep one writer from
 * destroying everyone else's routes:
 *
 * 1. An unreadable table is never treated as empty. Rewriting "the routes we
 *    know about" on top of a table we could not parse erases every other
 *    writer's routes. A missing file is empty; an invalid one is an error.
 * 2. Exit cleanup removes only the entries this process registered. Hostnames
 *    are not ownership: a second checkout of the same repository registers the
 *    same hostnames, and removing by name alone lets whichever checkout exits
 *    first unroute the one still serving.
 */

export interface RouteEntry {
	hostname: string;
	port: number;
	pid: number;
}

export class RoutesTableUnreadableError extends Error {
	constructor(
		readonly routesPath: string,
		readonly reason: string,
	) {
		super(
			`Refusing to rewrite ${routesPath}: ${reason}. Rewriting it now would drop every ` +
				"route other processes registered. Move it aside (e.g. `mv routes.json " +
				"routes.json.corrupt`) and restart each dev stack that uses this Portless " +
				"state directory so it re-registers.",
		);
		this.name = "RoutesTableUnreadableError";
	}
}

function isRouteEntry(entry: unknown): entry is RouteEntry {
	if (typeof entry !== "object" || entry === null) return false;
	const route = entry as RouteEntry;
	return (
		typeof route.hostname === "string" &&
		typeof route.port === "number" &&
		typeof route.pid === "number"
	);
}

/**
 * Parse `routes.json` contents. `raw === null` means the file does not exist,
 * which is an empty table. Anything else that is not a JSON array throws.
 * Individual malformed entries are dropped, matching Portless's own loader.
 */
export function parseRoutesTable(raw: string | null, routesPath: string): RouteEntry[] {
	if (raw === null) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new RoutesTableUnreadableError(
			routesPath,
			raw.trim() === "" ? "the file is empty (torn write?)" : "the file is not valid JSON",
		);
	}
	if (!Array.isArray(parsed)) {
		throw new RoutesTableUnreadableError(routesPath, "the file is not a JSON array");
	}
	return parsed.filter(isRouteEntry);
}

/** Replace any entries for the given hostnames with the given entries. */
export function upsertEntries(
	routes: readonly RouteEntry[],
	entries: readonly RouteEntry[],
): RouteEntry[] {
	const hostnames = new Set(entries.map((entry) => entry.hostname));
	return [...routes.filter((route) => !hostnames.has(route.hostname)), ...entries];
}

/** Remove every entry for the given hostnames, whoever registered it. */
export function removeHostnames(
	routes: readonly RouteEntry[],
	hostnames: readonly string[],
): RouteEntry[] {
	const names = new Set(hostnames);
	return routes.filter((route) => !names.has(route.hostname));
}

/**
 * Remove only the exact entries this process registered (same hostname, port
 * and pid). An entry another process has since written for the same hostname
 * survives.
 */
export function removeOwnedEntries(
	routes: readonly RouteEntry[],
	owned: readonly RouteEntry[],
): RouteEntry[] {
	return routes.filter(
		(route) =>
			!owned.some(
				(mine) =>
					mine.hostname === route.hostname && mine.port === route.port && mine.pid === route.pid,
			),
	);
}

export function sameRoutes(a: readonly RouteEntry[], b: readonly RouteEntry[]): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
