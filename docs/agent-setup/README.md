# Agent setup snapshot

The brief asks for the agent setup "as it ended up". Part of it lives outside this repo, in my user-level `~/.claude/`, so this folder is a sanitized copy of the pieces that shaped this build. The repo-level setup is in `AGENTS.md`, `CLAUDE.md` and `.claude/`.

Copied verbatim on 2026-10-05; personal tooling (notifications, terminal multiplexer state, machine environment, secrets) is left out.

## What is here

| Path | What it is | How it is used here |
| --- | --- | --- |
| `agents/implementer-judgment.md` | Opus, high effort: multi-file work with open design decisions, money and approval paths | Gate, executor, validator, harness wiring |
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

Effort: high effort only for demanding implementers; reviews never run at the highest effort, because it measurably degraded review quality.

## Plugins and MCP servers used

- **superpowers**: brainstorming, writing and executing plans, TDD, systematic debugging, verification before completion.
- **workflows**: committing, reviewing and shipping a change.
- **Context7**: current library docs before using any API (also in `.mcp.json`).

## What stays personal

Status-line, notification and multiplexer hooks, the machine environment file and `~/.zshrc.secrets` are not copied: they are about my machine, not about how this code was built.
