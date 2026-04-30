---
name: build
description: >-
  Autonomous implementation — picks up `ready`-labeled work items and builds them.
  Reads the work item, implements with TDD, creates PR, runs review gate, merges.
  No planning or design decisions — those are settled upstream by /backlog.
  Can be delegated to the daemon for autonomous execution.
  Triggers on: "build this", "implement this issue", "/build", "start building",
  "pick up the next task", "implement #N".
  This is Stage 5 of the development lifecycle (/product → /solution → /design → /spec → /backlog → /build).
argument-hint: "[#issue-number] [--alterego] [--alterego-model <model>]"
---

# /build — Autonomous Implementation

Pure executor. Picks up `ready`-labeled work items and builds them. No exploration, no design decisions — the work item already contains the implementation approach from `/backlog`'s PlanMode. This skill just executes.

This is **Stage 5** of the development lifecycle (/product → /solution → /design → /spec → /backlog → /build). It reads work items from `/backlog` (Stage 4) and produces branches, PRs, and merged code.

Because `/build` makes no design decisions, it can be delegated to the daemon for autonomous execution.

## Usage
```
/build #42                     → implement work item #42
/build                         → pick next ready issue
/build #42 --alterego          → implement + Codex cross-model review
/build #42 --alterego-model o3 → use specific Codex model
```

## Workflow

### 1. Resolve Target

**Issue number provided** (`/build #42`):
```bash
gh issue view 42 --json number,title,body,labels,state
```
Verify the issue has the `ready` label. If not, stop: "Issue #42 is not labeled `ready`. Run `/backlog #42` to prepare it for implementation."

**No args** (`/build`):
```bash
gh issue list --label ready --json number,title,labels --limit 5
```
Pick the highest priority `ready` issue. If none ready, stop: "No `ready` issues in the backlog. Run `/backlog` to prepare work items."

### 2. Claim Issue

**Check for conflicts before touching anything:**

```bash
# 1. Is the issue already claimed?
gh issue view <N> --json labels --jq '.labels[].name' | grep "in-progress"
```
If `in-progress` found → **STOP**: "Issue #N is already being worked on. Check for an existing branch or open PR."

```bash
# 2. Does a PR already exist for this issue?
gh pr list --search "Closes #<N> in:body" --state open --json number,headRefName --limit 1
```
If PR found → **STOP**: "PR already exists for #N. Check if work is in progress."

**Claim:**
```bash
gh issue edit <N> --add-label "in-progress" --remove-label "ready"
```

### 3. Create Branch

Detect if running inside a worktree:
```bash
git_dir=$(git rev-parse --git-dir)
```

**In a worktree** (git_dir contains `/worktrees/`):
You're already on an isolated branch. Use it — do NOT create a new branch.
```bash
git fetch origin main 2>/dev/null || true
git rebase origin/main
```

**In main checkout** (git_dir is `.git`):
```bash
rm -f .git/index.lock 2>/dev/null
git checkout -q -b feat/<issue-number>-<slug> main
```

### 4. Implement

Read the work item's **Implementation Approach** section. This tells you exactly which files to create/modify and which patterns to follow. No codebase exploration needed — `/backlog` already did that through PlanMode.

When implementing UI:

1. **Check for design registry** — look for `.claudius/design/registry/registry.json`. If it exists, this is the primary source for the design system.
2. **Install theme first** — the `registry:theme` item at `.claudius/design/registry/theme.json` must be installed before components so all OKLCH tokens are available. If shadcn MCP is available, use it to install. Otherwise: `npx shadcn add <theme-url>`.
3. **Install components by tier**:
   - **Tier 1** (shadcn base): `npx shadcn add button card dialog` — themed automatically
   - **Tier 1.5** (community): `npx shadcn add @magicui/animated-beam` — namespace syntax
   - **Tier 3** (modified): Install base, then apply variant modifications per `components.md`
   - **Tier 3** (custom): Build from spec in `components.md`
4. **Use semantic tokens** — always use `bg-primary`, `text-muted-foreground`, etc. Never hardcode colors.

Also read: `.claudius/design/tokens.css` for token values, `.claudius/design/components.md` for component specs and source tiers, `.claudius/design/screens.md` for screen layout guidance, and `references/frontend.md` (in the design skill) for visual design quality guidance.

**Solo (XS/S — ≤2 files, ≤100 lines):** Implement directly with TDD.
1. Write failing test from first acceptance criterion
2. Implement until test passes
3. Repeat for each AC
4. Run full suite: `bun run test`

**Team (M+ — >2 files, >100 lines):** Use the Agent tool to spawn developer and reviewer agents.

### 5. Validate

```bash
bun run test
bun run lint
bun run build
```

Fix any failures. Auto-fix lint: `bun run lint:fix`.

### 5b. E2E (UI-touching changes)

If the change touches a UI surface listed in the project's E2E capability matrix (typically defined in `.claude/rules/e2e.md` and/or `e2e/README.md`), affected E2E specs MUST pass before merge.

```bash
# Preferred: project ships a diff-aware selector
./scripts/e2e-affected.sh main   # prints affected tags + the playwright command

# Fallback: run by capability tag manually
bun run test:e2e:critical
```

**Hard gate (per-wave rule):** an E2E spec must exist or be extended for any change that adds/modifies a UI surface in the capability matrix. This rule traces to a documented incident where backfilled E2E hid regressions across multiple PRs — see manager memory `feedback_e2e_per_wave.md`. The manager refuses to merge if:

- Affected E2E specs fail (read `test-results/agent-summary.md` for the failure list), or
- The PR's UI epic has no E2E sibling task (per `/backlog`'s auto-create rule).

If the project doesn't yet have an E2E capability matrix, file a follow-up issue and proceed; do not block on absent infrastructure. Once a matrix exists, the gate applies to every UI-touching PR.

Skip E2E only when the change provably has no UI surface (pure backend types, internal refactor, docs).

### 5.5. Alterego Review (`--alterego` flag only)

When `--alterego` is passed, run the Codex cross-model convergence loop after validation and before committing.

- Fail-open: skip silently if Codex CLI not installed or `OPENAI_API_KEY` unset
- Skip if diff > 5000 lines
- Loop up to 3 iterations; `APPROVE` stops the loop
- `BLOCKER` (without `--force-alterego`) aborts PR creation
- `SUGGEST_IMPROVEMENTS`/`CONCERNS` → fix findings, re-validate, re-submit

### 6. Commit

```bash
git add <specific-files>
git commit -m "feat(<scope>): <description> (#N)"
```

### 7. Create PR

```bash
gh pr create --title "<description>" --body "$(cat <<'EOF'
## Summary
- What was done

## Closes
Closes #N

## Test Plan
- [ ] Specific test scenarios
EOF
)"
```

### 8. Update Issue

Check off completed acceptance criteria:
```bash
gh issue edit N --body "<body with checked boxes>"
```

### 9. Release Claim

After PR is created, remove `in-progress` (`ready` was already removed at claim time):
```bash
gh issue edit <N> --remove-label "in-progress"
```

### 10. Report

Print the PR URL. Done.

## Error Handling

- Test failures → fix and retry (max 3 attempts)
- Lint failures → auto-fix with `bun run lint:fix`, then retry
- Build failures → diagnose and fix
- 3 consecutive failures → restore `ready` and remove `in-progress`, comment on issue, tell user:
  ```bash
  gh issue edit <N> --remove-label "in-progress" --add-label "ready"
  ```
- Early exit → always restore `ready` when removing `in-progress` (best-effort):
  ```bash
  gh issue edit <N> --remove-label "in-progress" --add-label "ready"
  ```

## Rules

- **Only builds `ready` items** — refuse to implement issues without the `ready` label
- **No design decisions** — the implementation approach is in the work item. Follow it.
- **No PlanMode** — all planning happened upstream in `/backlog`. This skill executes.
- **TDD** — tests from acceptance criteria first, then code to pass them
- **One issue, one branch, one PR** — no multi-issue PRs
- **Claim before work** — always set `in-progress` and remove `ready` before creating the branch
- **Claim removes `ready`; failure restores it** — on happy path, `ready` is gone after claim; on failure/abort, restore `ready` when removing `in-progress`
- **Release claim on exit** — always update labels on exit (success: remove `in-progress`; failure: remove `in-progress` + restore `ready`)
- **E2E ships in the same wave as the feature** — UI-touching PRs require affected E2E to pass before merge AND require the parent epic to have an E2E sibling task (auto-created by `/backlog`). Backfilling E2E after an epic closes hides regressions; this is non-negotiable when a capability matrix exists in the project.

## What `/build` Does NOT Do

- **Explore the codebase to decide approach** — that's `/backlog`'s job via PlanMode
- **Make architecture decisions** — that's `/solution`
- **Write specifications** — that's `/spec`
- **Create new issues** — if scope expands, flag it and stop. Use `/backlog` to capture the new work.
- **Merge without review** — the review gate exists for a reason
