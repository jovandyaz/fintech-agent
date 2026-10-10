# Step 9 — Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. One brief per task in `step-9/`; every implementer reads `step-9/common.md` first.

**Goal:** a reviewer of the albo challenge can start the stack from the README, read in about two pages why the harness is built this way and where it is weak, hand a non-AI ops lead a one-page Spanish playbook, and find the compliance detail in an appendix; plus the one code owner carried into Step 9 (the seed's role passwords must never reach the Postgres log).

**Architecture:** documentation only, written from sources already in the repo: `specs/` (binding), `EVALS.md` (numbers), the ledger copy `docs/handoff/build-log/progress.md` (`Ruling:` lines), the code. No new claims: every fact in a doc is traceable to one of those, or, for the compliance appendix, to the official text it cites. Task 1 is the only code change.

**Tech Stack:** Markdown (GitHub-flavored, Mermaid for the one diagram), Prettier; Task 1: postgres.js 3, Testcontainers Postgres.

**Spec:** specs/04-build-plan.md §Step 9 (the "Must contain" table is the acceptance list); specs/00-scope.md (deliverables, ports, time table); specs/01 (pipeline, context policy, failure handling, observability); specs/02 (G1–G8, defense model, regulatory table, residual risk, Plain statement for Legal); specs/03 (EVALS shape — EVALS.md is already written and out of scope here); specs/references.md.

## Global Constraints

- AGENTS.md sequence: developing-feature → reviewing-pr (workflows 0.4.0) + invariant-reviewer read-only on Task 1 (G1/G6 path) → verifying-change with a fresh verifier → committing-change via `docs/handoff/commit-gate.sh "<subject>" [--int] <paths>`, one commit per task.
- Commits: one line ≤ 72 chars, Conventional Commits, English, imperative, no trailers, never squash/amend/force.
- No paid model calls. Every `docker compose` command an agent runs uses `--env-file /dev/null`. Never read `.env` or `.env.*.local`.
- English everywhere except `PLAYBOOK.md` (Spanish, Mexico, for non-AI experts, no jargon).
- Lengths: `PLAYBOOK.md` fits one printed page (≈ 500 words, hard max 560); `DESIGN.md` about two pages (target ≈ 1,400 words including tables, hard max 1,700; depth goes to links into `specs/`).
- Numbers (rates, costs, counts) are copied from `EVALS.md` or the ledger, never recomputed or rounded differently.
- No secrets, no real customer data, no dev token values beyond what README already prints for the local stack.

## Review Focus

1. A reader who follows README literally on a clean clone (no key) must reach a working console — the verifier runs it on a fresh stack.
2. A doc claim that the code no longer matches (a command, a flag, a file path, a guarantee) misleads the interviewer — the fact-check reviewer checks every command and path against the repo.
3. The compliance appendix must not state law it did not read — each legal citation names its source; no invented article numbers.
4. PLAYBOOK must be readable by an ops lead: no English terms of art (pass^3, TPR, kappa, MCP, token) — reviewer greps for them.
5. The seed must not log a role password on success or on error, under `log_statement = 'all'` — Task 1 test.

## Tasks

| #   | Brief              | Files                                                       | Commit subject                                                |
| --- | ------------------ | ----------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | `step-9/task-1.md` | `apps/api/src/database/roles.ts`, `roles.int.spec.ts` (new) | `fix(api): keep role passwords out of the Postgres log`       |
| 2   | `step-9/task-2.md` | `README.md`                                                 | `docs: complete the README`                                   |
| 3   | `step-9/task-3.md` | `DESIGN.md`                                                 | `docs: add DESIGN with trade-offs, defense model and rollout` |
| 4   | `step-9/task-4.md` | `docs/compliance.md`                                        | `docs: add the compliance appendix`                           |
| 5   | `step-9/task-5.md` | `PLAYBOOK.md`                                               | `docs: add the Spanish playbook for ops teams`                |
| 6   | `step-9/task-6.md` | `AI_NOTES.md`                                               | `docs: shape AI_NOTES around setup, speed-ups and errors`     |
| 7   | orchestrator       | `docs/handoff/README.md`, `docs/handoff/build-log/*`        | `docs: hand off after Step 9`                                 |

Execution: implementers 1–6 run in parallel (disjoint files). Doc implementers do not run `pnpm verify` (Task 1's RED state would fail it); they run Prettier on their file only. No gate runs while any implementer is active. Then one reviewing-pr pass over the whole diff (code-quality, superpowers, spec axis against the Step 9 table, standards axis, plus a fact-check reviewer and invariant-reviewer on Task 1), fixes, one fresh verifier, and commits in task order.
