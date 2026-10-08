# Step 6 — Evals: labels, runner, first run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, as Steps 4–7). Steps use checkbox syntax for tracking.

**Goal:** `pnpm eval` runs the 24 labeled cases through the real harness for variants A and B, grades every 03 metric (code-graded, plus groundedness by an Opus-class judge), prints them with cost and latency, writes `evals/results/`, and gates regressions; the first full run is recorded in EVALS.md with a decision by the 03 rule.

**Architecture:** a new workspace package `evals/` (TypeScript, run with tsx). The promptfoo provider runs `runCase` in-process against the compose stack's Postgres (as `copilot_api`), MCP server and core-mock: it opens a `source = eval` case through the webhook intake code, claims that exact case (`claimCase`), runs one attempt with the variant's model, and returns the persisted proposal, the raw model output, validator codes and the steps. The compose worker never claims an eval case, so a run is never raced by the stack. Checkers are plain functions over the provider's result and the label, shared by promptfoo `javascript` assertions and the report. Ports from Knowtis: the eval runtime (summaries by case and provider) and the calibration export and agreement.

**Tech Stack:** promptfoo 0.124.0 Node API (`evaluate`, `javascript` and `llm-rubric` assertions, per-test `options.repeat`, cache off), tsx, the api's harness modules imported directly, postgres.js, vitest for the evals' own unit specs.

**Spec:** specs/03-evals.md (binding), specs/04-build-plan.md §Step 6, specs/00-scope.md port rows "Eval runtime" and "Judgment export + agreement", specs/01-architecture.md (`evals/`, promptfoo row, models), specs/02-security.md (G1: no executions for eval cases; G6 masking in exported rows).

## Global Constraints

- AGENTS.md sequence per task: developing-feature → reviewing-pr + invariant-reviewer (any G1–G8 path) → verifying-change with a fresh verifier → committing-change via `docs/handoff/commit-gate.sh`. Ports use `feat(port): …`, one commit each, with their tests.
- `evals/cases.ts` labels and `evals/judge/groundedness.md` are committed **before** any paid run (`test: add labeled eval cases`); the rubric is frozen for the run.
- Paid calls: authorized by the user for one full run (≤ USD 15 total measured from `agent_runs.cost_usd` plus judge usage), and one more high-stakes run only if a prompt changes. Every other check uses scripted models or no model. Compose reads `.env` itself; the runner gets the key through `node --env-file-if-exists=.env` — nobody reads, prints or copies `.env`.
- Calibration labels are the user's: export the rows with instructions, never fill `labels.jsonl`; the judge stays informational until the user labels (03 rule 4).
- Unit and integration tests never call the runner and need no key (03).
- Same code rules: TDD with mutation checks, WHY-only comments, JSDoc on exports, named magic values, `as const` sets, no secrets, no dead code; Node 24 and 22.

## Review Focus

1. A case's repeats must not be merged across variants or across cases (caseKey by case id + provider).
2. A raw model output that a validator would block must still count against model-level injection resistance even though the persisted proposal is safe.
3. An eval case must never be claimed by the compose worker, and never executed (unauthorized executions = 0).
4. A missing key, a down stack, or a provider error must exit non-zero with a clear message, never a silent 0% or a partial table presented as complete.
5. Pass^3 must require all three attempts, and Wilson intervals / McNemar must be exact on small counts (0/30 → upper 9.5%).

---

### Task 1: Labeled cases (`test: add labeled eval cases`)

`evals/` package (package.json, tsconfig, vitest project, eslint coverage). `evals/cases.ts`: the 24 labels of 03 keyed by `ScenarioId` — category, action type and transaction id set, `must_call` (tool + argument), `must_cite_doc` (all required) and `may_cite_doc` (precision set), `abstain`, `must_mention`, `high_stakes`, `success_if` for ADV — each with a one-line rationale. Spec: ids match `SCENARIO_IDS`, every transaction id is planted for that scenario's customer, 14 high-stakes (10 ADV + 4 money-path), every `open_dispute` label mentions `{{folio}}` and `{{compromiso_dictamen}}`, docs exist in the manifest and none is quarantined. Then the judge rubric `evals/judge/groundedness.md` and the 7 known-bad controls `evals/judge/controls.ts`, committed before any run.

### Task 2: Port eval runtime (`feat(port)`)

`evals/runtime.ts` from Knowtis `eval-runtime.ts`, trimmed per 00: `summarizeTrials`, `toTrialResult`, `caseKeyOf` keyed by case id + provider id, usage and cost read from the provider response, repeats and variants from flags, a missing key exits non-zero, git SHA from `git rev-parse`. Ported tests trimmed to what stays.

### Task 3: Port calibration export and agreement (`feat(port)`)

`evals/calibration/`: judgment rows keyed by case and variant, first attempt only, mutation negatives (changed date, dropped citation, added promise), TPR/TNR with Wilson 95% intervals, kappa secondary; CLIs `eval:judgments`, `eval:agreement`; labels file format and the user's labeling instructions (blind: verdict hidden).

### Task 4: Harness hooks for evals

`claimCase(db, caseId, …)` claims one queued case by id (same fencing as `claimNextCase`); `claimNextCase` skips `source = eval`; `openEvalCase` opens a scenario's case through the intake code with `source = eval`. Integration tests: the worker never claims an eval case; `claimCase` claims exactly the named one; an eval case runs to a proposal and is never executed.

### Task 5: Provider and checkers

`evals/provider.ts` (variant id, in-process `runCase`, returns output, tokenUsage, cost, metadata: run_id, model, prompt_version, raw_output, validator_codes, steps, latency). `evals/checkers.ts`: every code-graded metric of 03 as a pure function of (result, label), unit-tested with fixture results — classification, action (type and exact), missed money-path, tool use, citation validity and precision, retrieval recall, ungrounded numbers/commitments on raw output, repairs per code, model-level injection resistance, system-level block, unauthorized executions.

### Task 6: Runner, report, gate

`evals/run.ts`: one `evaluate()` with `maxConcurrency: 4`, cache off, per-test `repeat` (3 high-stakes / 1 otherwise, `--repeat N`), `--variant A|B|both`, `--only ADV|high-stakes`; groundedness `llm-rubric` with `JUDGE_MODEL`; results JSON `evals/results/<date>-<sha>.json`; Markdown table; stats (pass@1, pass^3, Wilson, McNemar, attack-success upper bound, cost/latency p50/p95, fallback rate, steps per run); regression gate against `evals/baseline.json`; `pnpm eval`, `eval:report` (summary block into EVALS.md). Scripted-model integration test of one case end to end, no key.

### Task 7: Redactor recall

`evals/redactor-cases.ts`: 20 strings the deterministic masker misses by construction, each with its secret span; the runner reports recall and over-redaction (03), not a gate.

### Task 8: First full run and EVALS.md

Stack up with the key (compose reads `.env`), `pnpm eval` once (104 runs), measured cost; read failures case by case; `pnpm eval:judgments` export for the user; EVALS.md in 03's shape with the decision (judge informational); baseline.json from this run; ledger, AI_NOTES, handoff, push. Prompt changes, if any, are their own commits with before/after numbers.
