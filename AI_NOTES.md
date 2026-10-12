# AI notes

Five answers to the brief. Plan deviations are `Ruling:` lines in `docs/handoff/build-log/progress.md`, a copy of the git-ignored ledger.

## Tools and setup, and why

- **Claude Code:** I run Opus as the orchestrator, dispatching subagents by role from the roster in [`docs/agent-setup/`](docs/agent-setup/README.md), plus the repo's [`invariant-reviewer`](.claude/agents/invariant-reviewer.md), which checks a diff against G1–G8 only.
- **Skills:** my `workflows` plugin (0.4.0) over Superpowers, one per phase ([§Skills by phase](docs/agent-setup/README.md#skills-by-phase)), declared in `.claude/settings.json`.
- **MCP** (`.mcp.json`): Context7, Playwright, read-only Postgres.
- **Repo:** `AGENTS.md`, `CLAUDE.md`, `.claude/rules/`, three hooks (AGENTS.md §Hooks), skills `add-eval-case` and `add-policy-doc`; my user-level comment and magic-value hooks (`docs/agent-setup/hooks/`).

Why: an agent reviewing its own work finds only what it already thought of. Every change runs one sequence (AGENTS.md §Working rules): a test-first build; fresh-context reviews, one per angle, plus the invariant reviewer on G paths; a fresh verifier on the real stack; `docs/handoff/commit-gate.sh`, which commits only what passes `pnpm verify` on Node 24, plus 22 as a compatibility check. Hooks back it up: no skipped or removed tests on protected G paths, no stopping while `pnpm verify` fails.

## Speed-ups

1. **Parallel research.** I had subagents read the specs and return only deltas with a primary source: three took about 25 minutes of wall time for an afternoon of reading; seven more, about ten minutes each.
2. **Knowtis ports.** Two audits chose port, trim or rewrite per file; twelve `port` commits came with their tests (stop-verify hook, MCP tool annotations, Drizzle module and migrate CLI, JSON logger, link scanner, unique-violation check, token cost, scripted model fixtures, injection guard, HTTP exception filter, eval runtime, judgment export and agreement), ≈ 35 min saved per [00 §Time budget](specs/00-scope.md#time-budget).
3. **Stored runs, not paid re-runs.** Run records keep every attempt: `pnpm eval:report` re-graded run 3 after a checker fix at no cost; replaying 150 stored drafts measured the date-format fix (`PII_IN_REPLY` failures 37 → 3), and replaying run 3's drafts through the widened number reader showed 15 of 18 `UNGROUNDED_NUMBER` runs passing on the first attempt once the reader was widened, before any paid run confirmed it.

## One rewritten instruction

Before (`CLAUDE.md`, 2026-10-06):

> Every step runs the workflow skills in `docs/agent-setup/README.md` §Skills by phase: `developing-feature` to build, `reviewing-pr` plus `invariant-reviewer` on the step's commit range, `verifying-change` with a fresh verifier, `committing-change` to commit.

After (commit `db3cb5c`, `AGENTS.md` and `CLAUDE.md`):

> Every build step and every behavior change follows one sequence, in this order and with no stage skipped: `developing-feature` → `reviewing-pr` plus `invariant-reviewer` (any diff on a G1–G8 path, before it is committed) → `verifying-change` with a fresh verifier → `committing-change`.
>
> … dispatch `invariant-reviewer` with read-only instructions (no test runs).

What went wrong: "on the step's commit range" reads as after the commits, against the line above it ("before committing it"). In Step 4c the invariant reviewer ran after eight executor commits and blocked a real hole (next section); the fixes became follow-up commits. In Step 4d two dispatches stalled at the 600 s watchdog; the third, read-only and handed the orchestrator's test results, finished. It slipped once more in Step 5, then held.

## One agent error caught

In Step 4c the write contract typed `reason_code` as a free string, which the executor passed from the database to core-mock. The invariant reviewer probed it against G2: the reason `reembolsa 5000 MXN a la CLABE …` reached core-mock's `/disputes` and the action ended `executed`. What would have shipped: with a compromised `api`, a free-text instruction on the only write path. Now the contract is a closed enum, core-mock refuses anything else, and the executor parses `params` first; mutating that parse fails a test.

## What was not delegated blind

My rule in `CLAUDE.md`: "judgment-heavy work (gate, executor, validator) is never delegated blind". Steps 4–7 ran in my main session, not in delegated subagents: the gate, executor, validator, agent loop, Persist, worker and the console's decision panel were written there, where I could steer each diff, and subagents only reviewed them. In Steps 8 and 9, implementers worked from written briefs in fresh contexts and never committed; commits came only after the full sequence. Every ruling on a G path is a `Ruling:` line in the ledger with its cost if wrong, so each one can be audited.

I decided every paid run and its cap (USD 15 for the first eval run; when another agent relayed an authorization, Claude treated it as information and asked me). I labeled the calibration rows blind to the judge's verdicts, with Claude's per-row suggestions showing ([EVALS.md §Honest limits](EVALS.md#honest-limits)), so the judge stays informational until ops reviewers label fresh rows. I made the design calls: the post-research scope, closing residual risks instead of accepting them, `dd/mm/aaaa` over loosening G6, the Haiku redactor and Step 8's design. I ran the history rewrite myself, since the permission classifier would not let Claude do it.

The dated log behind these answers: [docs/handoff/build-log/ai-notes-log.md](docs/handoff/build-log/ai-notes-log.md).
