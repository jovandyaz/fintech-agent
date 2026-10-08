# Agent setup snapshot

The brief asks for the agent setup "as it ended up". Part of it lives outside this repo, in my user-level `~/.claude/`, so this folder is a sanitized copy of the pieces that shaped this build. The repo-level setup is in `AGENTS.md`, `CLAUDE.md` and `.claude/`.

Copied verbatim on 2026-10-05; personal tooling (notifications, terminal multiplexer state, machine environment, secrets) is left out.

## What is here

| Path | What it is | How it is used here |
| --- | --- | --- |
| `agents/implementer-judgment.md` | Opus, `xhigh` effort: multi-file work with open design decisions, money and approval paths | Gate, executor, validator, harness wiring |
| `agents/implementer-spec.md` | Sonnet: work whose brief already contains the exact code and tests | Mechanical ports, fixtures, docs tables |
| `agents/task-reviewer.md` | Opus: review gate on one task's diff | After each judgment-heavy step |
| `agents/re-reviewer.md` | Sonnet: scoped re-check of a fix round | After fixing review findings |
| `agents/final-reviewer.md` | Highest tier: whole-branch review before calling the build done | End of the build |
| `agents/code-reviewer.md` | Read-only ad-hoc reviewer | Audits (the specs were audited against the brief this way) |
| `rules/tech-debt.md` | No dead code, bugs fixed or ticketed at once, no orphan TODOs | Applies to every step |
| `rules/comments.md` | Zero comments by default; only contract docs and non-obvious whys | Enforced by `hooks/comment-policy.cjs` |
| `rules/magic-values.md` | Named constants and `as const` unions instead of literals | Enforced by `hooks/magic-values-policy.mjs` |
| `rules/javascript-typescript.md` | House TypeScript style | Mirrored in `.claude/rules/typescript.md` |
| `hooks/comment-policy.cjs` | User-level PreToolUse hook that blocks writes adding non-compliant comments | Runs on every edit in every repo |
| `hooks/magic-values-policy.mjs` | User-level PreToolUse hook that blocks unnamed thresholds and repeated string literals | Runs on every edit in every repo |

## Model tiering

The main session orchestrates and dispatches by role, not by model name. Two schemes, chosen per session:

- **Scheme A**, a top-tier model orchestrates: the roster as listed; money-path reviews may go to the highest tier.
- **Scheme B**, Opus orchestrates (this build): no highest-tier model; final and money-path reviews are overridden to Opus at dispatch; escalation caps at Opus.

Effort: `xhigh` only for demanding implementers; reviews never run at `xhigh`, because it measurably degraded review quality; nothing runs below the `high` default.

## Skills by phase

The repo declares the plugins it is built with in `.claude/settings.json` (`extraKnownMarketplaces` + `enabledPlugins`), so a clone asks for the same set once the folder is trusted. The workflow skills come from my public marketplace [`jovandyaz/agentic-development-workflows`](https://github.com/jovandyaz/agentic-development-workflows); they orchestrate Superpowers rather than copy it.

| Phase | Skill | How it shows up here |
| --- | --- | --- |
| Standards and docs | `workflows:applying-engineering-standards`, Context7 | Every library API is checked against the installed version or its official docs before use; material decisions are recorded as `Decision / Project evidence / Official source / Tradeoff / Verification` in the ledger |
| Design | `superpowers:brainstorming` | The specs in `specs/` are the approved design; a change that reopens one goes through brainstorming and a `docs:` commit |
| Planning | `superpowers:writing-plans` | `specs/04-build-plan.md` is the plan; deviations are `Ruling:` lines in the ledger |
| Execution | `workflows:developing-feature`, `superpowers:executing-plans`, `superpowers:test-driven-development` | Each build step and each behavior change outside a step; every test is seen failing first, and mutation checks prove the tests bite |
| Bugs | `workflows:fixing-bug`, `superpowers:systematic-debugging` | A defect starts with the test that reproduces it |
| Review | `workflows:reviewing-pr` (code-quality gate, then `superpowers:requesting-code-review`, then separate Spec and Standards subagents that are never merged into one verdict), plus the repo's `invariant-reviewer` | At the end of every step on that step's commit range, and on the whole branch at the end. The Anthropic `code-review` lens publishes to GitHub, so it stays off: the repo is local |
| Verification | `workflows:verifying-change`, `superpowers:verification-before-completion` | A fresh verifier checks each claim: `curl --fail-with-body` for HTTP surfaces, Playwright MCP (desktop and mobile) for the console, promptfoo evals for agent behavior |
| Commit | `workflows:committing-change` | One concern per commit, single-line Conventional Commits, never squashed |

Prerequisites outside the plugins: the MCP servers in `.mcp.json` (Context7, Playwright and a read-only Postgres). Matt Pocock's `code-review` was part of `reviewing-pr` until workflows 0.4.0; it was dropped because its two axes duplicated `code-quality` and `requesting-code-review` and its setup writes scaffolding into the repo.

## What stays personal

Status-line, notification and multiplexer hooks, the machine environment file and `~/.zshrc.secrets` are not copied: they are about my machine, not about how this code was built.
