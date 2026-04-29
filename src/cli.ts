#!/usr/bin/env bun
/**
 * nterprise CLI — subcommand-first dispatcher.
 *
 *   nterprise                  — start dev stack (alias of `nterprise dev up`)
 *   nterprise dev [up|down|clean|list]
 *   nterprise repos [up|down|status|logs <name>|add <path> [name]|remove <name>|list]
 *   nterprise doctor [--fix]
 *   nterprise uninstall
 *   nterprise --help | -h | help
 *
 * Back-compat shorthands preserved from the previous flat parser:
 *   nterprise --down  → nterprise dev down
 *   nterprise --clean → nterprise dev clean
 *   nterprise down    → nterprise dev down
 *
 * Each `run*` function lives in its own module:
 *   ./dev-cli.ts      runDev
 *   ./repos/orchestrate.ts  runRepos
 *   ./doctor.ts       runDoctor, runUninstall
 */

import { runDev } from "./dev-cli";
import { runDoctor, runUninstall } from "./doctor";
import { runRepos } from "./repos/orchestrate";

export function printHelp(): void {
	const lines = [
		"nterprise — dev tooling for the nterprise stack",
		"",
		"Usage:",
		"  nterprise                              start dev stack (cwd)",
		"  nterprise dev [up|down|clean|list]     per-repo dev orchestration",
		"  nterprise repos [up|down|status|...]   multi-repo orchestration",
		"  nterprise doctor [--fix]               diagnose / install LaunchDaemon",
		"  nterprise uninstall                    remove LaunchDaemon + anchor",
		"  nterprise --help | -h | help           this help",
		"",
		"`nterprise repos` actions:",
		"  up                                    start `bun run dev` in each registered repo",
		"  down                                  stop each registered repo",
		"  status                                show pid + alive state per repo",
		"  logs <name>                           tail per-repo log",
		"  add <path> [name]                     register a repo",
		"  remove <name>                         drop a repo from the registry",
		"  list                                  print the registry",
		"",
		"Config:",
		"  Per-repo dev config lives at package.json#nterprise (legacy keys",
		"  #portfree, #portless are also accepted).",
		"  Multi-repo registry: ~/.config/nterprise/repos.json",
		"  LaunchDaemon: dev.nterprise.pfctl (migrates from dev.portfree.pfctl).",
	];
	console.log(lines.join("\n"));
}

async function dispatch(): Promise<number> {
	const [, , groupRaw, action, ...rest] = process.argv;
	const group = groupRaw;

	switch (group) {
		case undefined:
		case "dev":
			return runDev(action, rest);

		// Legacy shorthand: `nterprise --down`, `nterprise --clean`,
		// `nterprise down`, `nterprise list` etc. all behave like `nterprise dev <…>`
		// when invoked without an explicit group.
		case "down":
		case "clean":
		case "list":
			return runDev(group, rest);

		case "--down":
		case "--clean":
			return runDev(group, rest);

		case "repos":
			return runRepos(action, rest);

		case "doctor":
			return runDoctor({ fix: rest.includes("--fix") || action === "--fix" });

		case "uninstall":
			return runUninstall();

		case "--help":
		case "-h":
		case "help":
			printHelp();
			return 0;

		default:
			console.error(`unknown subcommand: ${group}. Try \`nterprise --help\`.`);
			return 1;
	}
}

// Only run dispatch when invoked as a CLI, not when imported (e.g. by tests).
if (import.meta.main) {
	const code = await dispatch();
	process.exit(code);
}

// Exported for tests.
export { dispatch };
