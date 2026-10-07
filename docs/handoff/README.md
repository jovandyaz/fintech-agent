# Build handoff

Snapshot of where the build stands against `specs/04-build-plan.md`, for resuming in a new session. Written 2026-10-07.

## Where things are

All work is on `main`. Steps 0–3 are done, and Step 4 is done through 4e Task 9 (`runCase` and the worker loop, without the Nest wiring). Every commit passed `pnpm verify` on Node 24 and 22, plus the integration suite on G-path commits.

The remote branch `wip/step-4e-persist` (8f013a1) is a superseded snapshot of Task 8 with two failing tests. The reviewed version landed on `main` as c7c1b9b and 9afd6a5. Delete that branch when convenient.

`build-log/progress.md` is a copy of the ledger (`.superpowers/sdd/04-build-plan/progress.md`, git-ignored). Its `Ruling:` and `Owner:` lines are binding decisions and carried obligations. `build-log/step-4*-plan.md` are the per-substep plans. To resume on another machine, copy `build-log/*` into `.superpowers/sdd/04-build-plan/`.

## Remaining work

### Step 4e: Agent loop, Intake, Persist and the worker (`build-log/step-4e-plan.md`)

1. **Task 10, masking at sinks e2e.**
   - `apps/api/test/pii-sinks.e2e.spec.ts`: scan `run_steps`, `audit_log`, logger output and an in-memory OTel exporter. Include the telemetry `recordInputs/recordOutputs: false` check.
   - Mint a token against the real MCP server.
   - Design is in the ledger (`Step 4e Task 10 design`): per-call `Telemetry` integration, a masking `SpanProcessor`, no global registration.
2. **Close-out.**
   - Spec docs for anything the code made untrue.
   - A fresh verifier, including `docker compose up` (seed → api → executor).
   - A live probe with `ANTHROPIC_API_KEY` for ruling I5: `activeTools: []` with `tool_use` blocks in history. If the API rejects it, change the last-step strategy in a `docs:` commit.
   - Update `AI_NOTES`.

### Then, in the order the user chose (4e → 5 → 7, then 6 → 8 → 9)

| Step                               | Plan estimate | Outcome                                                                                                              |
| ---------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| 5 Policies and retrieval           | 60 min        | 10 policy docs, ingestion with the ported guard and quarantine, full-text search, `retrieval.spec.ts` recall@4 ≥ 0.9 |
| 7 Webhook, queue, console          | 135 min       | Webhook, `POST /cases`, `demo:post`, React console; **first end-to-end test through the UI**                         |
| 6 Evals                            | 130 min       | Labels before the first run, runner, judge calibration, first run of both variants                                   |
| 8 Traces, alerts, variant decision | 45 min        | `ops/alerts.sql`, `ops/scan-logs.mjs`, the 03 decision rule                                                          |
| 9 Docs                             | 70 min        | README, DESIGN, compliance appendix, EVALS, PLAYBOOK (Spanish), AI_NOTES                                             |
| 10 Rehearsal                       | 15 min        | Outside the budget                                                                                                   |

Each step gets its own plan in `.superpowers/sdd/04-build-plan/step-N-plan.md` before work starts.

### Carried owners (from the ledger)

- **Step 5:** canary templates cite real policy chunks.
- **Step 5 close → Task 9c:** wire `runWorker` in `main.ts` with `claimNextCase`, `runCase` deps from config, `createAnthropic({ apiKey })` or null, `connectCaseTools`, an `AbortController` on shutdown, and the compose env. `sleep` must swallow aborts and `onError` must mask, as `executor/main.ts` does. Until then compose cannot run a case.
- **Step 6:** measure the `UNGROUNDED_NUMBER` repair rate on clean cases.
- **Step 7:**
  - The console must not tell canaries apart: empty trace, ticket format, missing `webhook_events` row, a clone without the investigating pause.
  - `trust proxy` for `request.ip`.
  - Offer `APPROVED_FACTOR_WARNINGS` for insertion.
  - Return a status code for a duplicate `ticket_id` under a new `event_id`.
- **Step 8:** quality metrics count `operator_override` as `wrong_action` and exclude canaries.

## Working rules that are easy to lose

- Every behavior change follows the AGENTS.md sequence: `developing-feature` → `reviewing-pr` + `invariant-reviewer` (read-only) → `verifying-change` with a fresh verifier → `committing-change`.
- Commits:
  - one line, ≤ 72 chars, Conventional Commits, no trailers;
  - never squash, amend or force push;
  - a spec change is its own `docs:` commit.
- Commit through `docs/handoff/commit-gate.sh "<subject>" [--int] <paths>`. It stashes everything else, so verify sees only what is committed.
- Node: run through `fnm exec --using=24 -- …`; the machine default is 22, and both must pass.
- Never read `.env` or `.env.*.local`; no secret literals.
