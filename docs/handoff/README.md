# Build handoff

Snapshot of where the build stands against `specs/04-build-plan.md`, for resuming in a new session. Written 2026-10-07.

## Where things are

All work is on `main`. Steps 0–3 are done, and Steps 4 and 5 are done: the gate, executor, validator, agent loop, Persist, `runCase`, the worker loop, masking at every PII sink, the injection guard (Knowtis port), ten policy docs ingested by `seed` (pol-09 quarantined), and Spanish full-text search (recall@4 1.0 on 25 paraphrases and 5 held-out). `docker compose up` is healthy and the worker runs inside `api` (Task 9c): a queued case is claimed and investigated, or ends `no_api_key` without a key. Cases cannot be created from outside yet: that is Step 7. Every commit passed `pnpm verify` on Node 24 and 22, plus the integration suite on G-path commits.

The remote branch `wip/step-4e-persist` (8f013a1) is a superseded snapshot of Task 8 with two failing tests. The reviewed version landed on `main` as c7c1b9b and 9afd6a5. Delete that branch when convenient.

`build-log/progress.md` is a copy of the ledger (`.superpowers/sdd/04-build-plan/progress.md`, git-ignored). Its `Ruling:` and `Owner:` lines are binding decisions and carried obligations. `build-log/step-4*-plan.md` are the per-substep plans. To resume on another machine, copy `build-log/*` into `.superpowers/sdd/04-build-plan/`.

## Remaining work

### Next: Step 7, webhook and console

Plan it in `.superpowers/sdd/04-build-plan/step-7-plan.md` first (04 §Step 7): the Standard Webhooks endpoint (raw-body signature, ±5 min, rotation, 32 KB, idempotency ledger, folio and acuse), `POST /cases`, `pnpm demo:post`, and the React console (inbox, case detail with trace, edit reply, decide), then the first end-to-end test through the UI with Playwright. Carried owners for Step 7 are listed below.

### Then, in the order the user chose (4e → 5 → 7, then 6 → 8 → 9)

| Step                               | Plan estimate | Outcome                                                                                                              |
| ---------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| 5 Policies and retrieval (done)    | 60 min        | 10 policy docs, ingestion with the ported guard and quarantine, full-text search, `retrieval.spec.ts` recall@4 ≥ 0.9 |
| 7 Webhook, queue, console          | 135 min       | Webhook, `POST /cases`, `demo:post`, React console; **first end-to-end test through the UI**                         |
| 6 Evals                            | 130 min       | Labels before the first run, runner, judge calibration, first run of both variants                                   |
| 8 Traces, alerts, variant decision | 45 min        | `ops/alerts.sql`, `ops/scan-logs.mjs`, the 03 decision rule                                                          |
| 9 Docs                             | 70 min        | README, DESIGN, compliance appendix, EVALS, PLAYBOOK (Spanish), AI_NOTES                                             |
| 10 Rehearsal                       | 15 min        | Outside the budget                                                                                                   |

Each step gets its own plan in `.superpowers/sdd/04-build-plan/step-N-plan.md` before work starts.

### Carried owners (from the ledger)

- **Step 8:** wire production tracing — `new OpenTelemetry({ tracer })` over a provider whose exporter processor is wrapped in `maskingSpanProcessor`, passed as `RunCaseDeps.telemetry`; move `@ai-sdk/otel`, `@opentelemetry/api`, `@opentelemetry/sdk-trace` to `dependencies`; test that the wired provider masks.
- **Step 6:**
  - Measure the `UNGROUNDED_NUMBER` repair rate on clean cases.
  - An eval or judge control phrased "tu abono llegará a más tardar el segundo día hábil" (a paraphrased credit promise, 02 residual row 1).
  - Measure retrieval recall on the eval set; the 25 test paraphrases are no longer fully held out.
- **Step 7:**
  - The console must not tell canaries apart: empty trace, ticket format, missing `webhook_events` row, a clone without the investigating pause.
  - `trust proxy` for `request.ip`.
  - Offer `APPROVED_FACTOR_WARNINGS` for insertion.
  - Return a status code for a duplicate `ticket_id` under a new `event_id`.
  - Canary dispute drafts use a bare `{{fecha_limite_dictamen}}`; a real `open_dispute` reply carries `{{compromiso_dictamen}}` (03). Align them.
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
