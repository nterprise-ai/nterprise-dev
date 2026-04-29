/**
 * read-env-stack — load `.env.dev` defaults into process.env at nterprise startup.
 *
 * Why this exists:
 * Some monorepos (notably ones using strict env-validation libraries like
 * `@t3-oss/env-nextjs` or hand-rolled equivalents) crash at import time when
 * any expected key is missing — including keys that aren't actually exercised
 * during dev. Without nterprise, the workaround is a per-repo shell shim that
 * exports `${KEY:-stub}` defaults before launching dev. This module replaces
 * that shim with an nterprise-native convention:
 *
 *   .env.dev      committed; flat KEY=value defaults
 *   .env.local    gitignored; real values, loaded by Next.js/Vite/etc per-app
 *
 * Semantics: defaults only. Each parsed key is set in process.env ONLY if the
 * key is currently undefined. Real values from the shell, or from `.env.local`
 * loaded later by the framework, always win.
 *
 * nterprise does NOT load `.env.local` itself — that's the framework's job.
 * nterprise only ensures every key has SOMETHING set so strict-validation
 * passes at import time.
 *
 * No deps; uses Node fs + a tiny parser.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ENV_DEV_FILE = ".env.dev";

/**
 * Parse a flat KEY=value file into an object. Tolerates:
 *   - blank lines
 *   - full-line `#` comments
 *   - leading/trailing whitespace on keys + values
 *   - single- or double-quoted values (quotes are stripped)
 *   - `export KEY=value` (the `export` keyword is dropped)
 *
 * Does NOT support: variable interpolation (`${OTHER_VAR}`), multiline values,
 * inline (trailing) comments after a value. Keep `.env.dev` simple.
 *
 * Exported for testing.
 */
export function parseEnvFile(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	const lines = text.split(/\r?\n/);
	for (const raw of lines) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;

		// Drop optional `export` prefix
		const stripped = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;

		const eq = stripped.indexOf("=");
		if (eq < 0) continue; // malformed — skip silently

		const key = stripped.slice(0, eq).trim();
		if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

		let value = stripped.slice(eq + 1).trim();

		// Strip matched surrounding quotes
		if (
			(value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
			(value.startsWith("'") && value.endsWith("'") && value.length >= 2)
		) {
			value = value.slice(1, -1);
		}

		out[key] = value;
	}
	return out;
}

/**
 * Load `.env.dev` from the given directory (default: cwd) and apply each key
 * as a default into `process.env` (only when not already set).
 *
 * Returns the number of keys that were applied (newly set), so the caller can
 * log a single concise summary. Logs nothing itself — callers control output.
 */
export function loadEnvStack(cwd: string = process.cwd()): {
	loaded: boolean;
	path: string;
	applied: number;
	skipped: number;
} {
	const path = join(cwd, ENV_DEV_FILE);
	if (!existsSync(path)) {
		return { loaded: false, path, applied: 0, skipped: 0 };
	}

	const text = readFileSync(path, "utf8");
	const defaults = parseEnvFile(text);

	let applied = 0;
	let skipped = 0;
	for (const [key, value] of Object.entries(defaults)) {
		if (process.env[key] === undefined || process.env[key] === "") {
			process.env[key] = value;
			applied++;
		} else {
			skipped++;
		}
	}

	return { loaded: true, path, applied, skipped };
}
