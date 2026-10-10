# Task 2 — README.md

Read `common.md` first. Spec row: `README.md` in specs/04-build-plan.md §Step 9. The README is started (56 lines: Run it, The console, Sample cases, Without a key, Tests); complete it, keep what is right, fix what is stale.

## Required

- Everything in the spec row: `export ANTHROPIC_API_KEY=… && docker compose up` starts everything, seed included; where the console is (URL, dev operator tokens as already printed); `pnpm demo:post <ids…>` with two or three useful ids and what to look at; `pnpm test` needs Docker and no key; `pnpm eval` needs the stack and a key, and that it costs money (cost of one full run and of `--only <id>` from EVALS.md); what happens without a key (`AGENT_MODE`, fallback behavior — check `.env.example` and specs/01 §Failure handling).
- Short, scannable additions the stack now has: `pnpm e2e` prerequisites (ledger owner Step 7 Task 9: `playwright install chromium`, `docker compose down -v`, `AGENT_MODE=off`); canaries (`canary:inject`, how to run it inside compose — check the ledger for the working entry); ops (`ops/README.md`, `pnpm ops:scan-logs`, `pnpm ops:scan-traces` — one line each with the command); the kill switch `AGENT_MODE=off`.
- A "Read next" block linking DESIGN.md, EVALS.md, PLAYBOOK.md (Spanish, for ops teams), AI_NOTES.md, docs/compliance.md, specs/. These files land in this same step; link them anyway.
- A one-paragraph "what this is" at the top (from AGENTS.md's first paragraph and specs/00-scope.md), no more.

Target ≤ 900 words. Every command must exist as written (package.json scripts, compose service names).
