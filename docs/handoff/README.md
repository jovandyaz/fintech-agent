# Build handoff

Snapshot of where the build stands against `specs/04-build-plan.md`, for resuming in a new session. Written 2026-10-07.

## Where things are

All work is on `main`. Steps 0–3 are done, and Step 4 is done (4a–4e and its close-out): the gate, executor, validator, agent loop, Persist, `runCase`, the worker loop and masking at every PII sink, with `docker compose up` healthy. The worker is not wired into `api` yet (Task 9c, after Step 5). Every commit passed `pnpm verify` on Node 24 and 22, plus the integration suite on G-path commits.

The remote branch `wip/step-4e-persist` (8f013a1) is a superseded snapshot of Task 8 with two failing tests. The reviewed version landed on `main` as c7c1b9b and 9afd6a5. Delete that branch when convenient.

`build-log/progress.md` is a copy of the ledger (`.superpowers/sdd/04-build-plan/progress.md`, git-ignored). Its `Ruling:` and `Owner:` lines are binding decisions and carried obligations. `build-log/step-4*-plan.md` are the per-substep plans. To resume on another machine, copy `build-log/*` into `.superpowers/sdd/04-build-plan/`.

## Remaining work

### Next: Step 5, then Task 9c

1. **Step 5, policies and retrieval** (plan in `.superpowers/sdd/04-build-plan/step-5-plan.md`, to be written): 10 policy docs, ingestion with the ported guard and quarantine, full-text search, `retrieval.spec.ts` recall@4 ≥ 0.9; the real `Retrieval` and injection scan for `runCase`.
2. **Task 9c, right after Step 5:** wire `runWorker` in `main.ts` (`claimNextCase`, `runCase` deps from config, `createAnthropic({ apiKey })` or null, `connectCaseTools`, an `AbortController` on shutdown; `sleep` swallows aborts and `onError` masks, as `executor/main.ts` does); compose env (`REDACTOR_MODEL` etc.); `api` depends_on `mcp` healthy; compose.spec asserts only `api` and `mcp` hold `CASE_TOKEN_KEY`; if tracing is wired here, its exporter sits behind `maskingSpanProcessor` with a test.

### Then, in the order the user chose (4e → 5 → 7, then 6 → 8 → 9)

| Step                               | Plan estimate | Outcome                                                                                                              |
| ---------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| 5 Policies and retrieval (next)    | 60 min        | 10 policy docs, ingestion with the ported guard and quarantine, full-text search, `retrieval.spec.ts` recall@4 ≥ 0.9 |
| 7 Webhook, queue, console          | 135 min       | Webhook, `POST /cases`, `demo:post`, React console; **first end-to-end test through the UI**                         |
| 6 Evals                            | 130 min       | Labels before the first run, runner, judge calibration, first run of both variants                                   |
| 8 Traces, alerts, variant decision | 45 min        | `ops/alerts.sql`, `ops/scan-logs.mjs`, the 03 decision rule                                                          |
| 9 Docs                             | 70 min        | README, DESIGN, compliance appendix, EVALS, PLAYBOOK (Spanish), AI_NOTES                                             |
| 10 Rehearsal                       | 15 min        | Outside the budget                                                                                                   |

Each step gets its own plan in `.superpowers/sdd/04-build-plan/step-N-plan.md` before work starts.

### Carried owners (from the ledger)

- **Step 5:** canary templates cite real policy chunks.
- **Step 5 close → Task 9c:** wire `runWorker` in `main.ts` with `claimNextCase`, `runCase` deps from config, `createAnthropic({ apiKey })` or null, `connectCaseTools`, an `AbortController` on shutdown, and the compose env. `sleep` must swallow aborts and `onError` must mask, as `executor/main.ts` does. Until then compose cannot run a case.
- **Step 5:** `searchPoliciesTool` (`apps/api/src/agent/core/tools.ts`) has no catch: a retrieval error reaches the next model call and a span with its raw message. Map it to a closed error (or stop the run as for MCP tools) and test it.
- **Step 8 (or 9c if first):** wire production tracing — `new OpenTelemetry({ tracer })` over a provider whose exporter processor is wrapped in `maskingSpanProcessor`, passed as `RunCaseDeps.telemetry`; move `@ai-sdk/otel`, `@opentelemetry/api`, `@opentelemetry/sdk-trace` to `dependencies`; test that the wired provider masks.
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
