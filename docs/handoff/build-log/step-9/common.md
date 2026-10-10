# Step 9 — rules every implementer follows

Repo: /Volumes/Personal/Github/fintech-agent (pnpm monorepo). Read first: AGENTS.md, the plan `.superpowers/sdd/04-build-plan/step-9-plan.md` (Global Constraints + Review Focus), your brief, and `specs/04-build-plan.md` §Step 9 (the row for your file is your acceptance list — every item in it must appear). Specs in `specs/` are binding.

- **Do not commit, stash, reset, or push.** Leave changes in the working tree. Touch only the files your brief lists; other implementers are editing other files in the same tree right now.
- **Never read `.env` or `.env.*.local`.** Every `docker compose` command uses `--env-file /dev/null`. No paid model calls; no `ANTHROPIC_API_KEY`.
- **Sources, not memory.** Every fact you write comes from: `specs/*.md`, `EVALS.md` (all numbers), `docs/handoff/build-log/progress.md` (the build ledger; `Ruling:` lines are decisions with their cost-if-wrong), `docs/handoff/README.md`, `AI_NOTES.md`, `docs/agent-setup/`, `ops/README.md`, or the code. If a required item has no source, say so in your report instead of inventing it. Copy numbers exactly; do not recompute.
- **Commands and paths you name must exist.** Check each against `package.json` scripts, `docker-compose.yml` and the file tree before writing it.
- **Style:** plain, direct prose; short sentences; tables where the spec asks for a comparison. Link to `specs/…` sections for depth instead of repeating them. No marketing words, no emojis. English except PLAYBOOK.md.
- **Doc tasks:** do not run `pnpm verify` (another task's test is mid-RED). Run `pnpm exec prettier --write <your file>` and report `wc -w <your file>`.
- **Code task (Task 1):** TDD with mutation checks; WHY-only comments; JSDoc on exports; named constants (PreToolUse hooks enforce comment and magic-value policy — fix the code, don't fight the hook). Node via `fnm exec --using=24 -- <cmd>`; integration: `fnm exec --using=24 -- pnpm vitest run --project integration <path>` (Docker running).
- **Report back (≤ 300 words):** status DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT; files changed; word count (docs); for each item of your spec row, the heading/line where it lives; any item you could not source; deviations and why. Task 1 adds RED evidence, mutations and which test killed each.
