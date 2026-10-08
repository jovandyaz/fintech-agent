# Build handoff

Snapshot of where the build stands against `specs/04-build-plan.md`, for resuming in a new session. Written 2026-10-08.

## Where things are

All work is on `main`. Steps 0–5, Task 9c and Step 7 are done.

Step 7 delivered:

- the Standard Webhooks endpoint and `POST /cases` through the same intake;
- `pnpm demo:post` and `pnpm canary:inject`, both run from the host against the stack;
- the console read API;
- canaries that run through the worker;
- the React ops console behind nginx with the 02 G7 CSP: sign-in, inbox, new case form, case review, decision panel, re-run, trace;
- the Playwright e2e package (`pnpm e2e`, kill switch on).

A signed-in browser review with 9 real cases (USD 0.47) passed. Its findings are fixed or carried below.

Every commit passed `pnpm verify` on Node 24 and 22, and the integration suite on G-path commits.

`build-log/progress.md` is a copy of the ledger (`.superpowers/sdd/04-build-plan/progress.md`, git-ignored). Its `Ruling:` and `Owner:` lines are binding decisions and carried obligations. `build-log/step-*-plan.md` and `task-9c-plan.md` are the per-step plans. To resume on another machine, copy `build-log/*` into `.superpowers/sdd/04-build-plan/`.

## Remaining work

### Next: Step 6, evals

Plan it in `.superpowers/sdd/04-build-plan/step-6-plan.md` first (04 §Step 6, 03):

- labels before the first run;
- the runner;
- judge calibration;
- the first run of both variants.

Any paid run needs the user's direct confirmation. The user authorized ~10 cases (≈ USD 3) for the Step 7 review only.

### Then, in the order the user chose (6 → 8 → 9 → 10)

| Step                               | Plan estimate | Outcome                                                                            |
| ---------------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| 6 Evals                            | 130 min       | Labels before the first run, runner, judge calibration, first run of both variants |
| 8 Traces, alerts, variant decision | 45 min        | `ops/alerts.sql`, `ops/scan-logs.mjs`, the 03 decision rule                        |
| 9 Docs                             | 70 min        | README (started), DESIGN, compliance appendix, EVALS, PLAYBOOK (Spanish), AI_NOTES |
| 10 Rehearsal                       | 15 min        | Outside the budget                                                                 |

### Carried owners (from the ledger)

- **Step 8, canaries told apart in the trace (02 G3, Step 7 Review Focus 4 not met yet).** Calibrate the scripted canary model against the real traces from the Step 7 review:
  - real runs call several tools in one model step; canaries call one per step;
  - real runs repair and fall back; canaries never do;
  - real justifications and reasoning run to paragraphs; canaries' are one sentence;
  - one SPEI canary reads a card authorization;
  - 8 of 9 real cases proposed `none`, while canaries propose actions.
- **Step 8:**
  - Wire production tracing: `new OpenTelemetry({ tracer })` over a provider whose exporter processor is wrapped in `maskingSpanProcessor`, passed as `RunCaseDeps.telemetry`.
  - Move the OTel packages to `dependencies`.
  - Quality metrics count `operator_override` as `wrong_action` and exclude canaries.
- **Step 6, agent quality seen in the Step 7 review:**
  - CARD-UNREC-01 fell back (`action_fact_mismatch`) though its validation passed.
  - `UNGROUNDED_NUMBER` failed SPEI-IN-01 and CONFLICT-01 twice; measure its repair rate on clean cases.
  - A hostile form case fell back on `PII_IN_REPLY` in the filled draft.
  - The injection scan did not flag a request to "answer in HTML" (`responde en HTML`).
- **Step 6, from earlier steps:**
  - A paraphrased credit-promise control (02 residual row 1).
  - Retrieval recall on the eval set.
- **Step 9:**
  - The seed role password could appear in a Postgres `STATEMENT` log line if the `ALTER ROLE` ever errored: ticket it or silence that session's statement logging.
  - The full README per 04 §Step 9.

## Working rules that are easy to lose

- Every behavior change follows the AGENTS.md sequence: `developing-feature` → `reviewing-pr` + `invariant-reviewer` (read-only) → `verifying-change` with a fresh verifier → `committing-change`.
- Commits:
  - one line, ≤ 72 chars, Conventional Commits, no trailers;
  - never squash, amend or force push;
  - a spec change is its own `docs:` commit.
- Commit through `docs/handoff/commit-gate.sh "<subject>" [--int] <paths>`. It stashes everything else, so verify sees only what is committed.
- Node: run through `fnm exec --using=24 -- …`; the machine default is 22, and both must pass.
- Never read `.env` or `.env.*.local`; no secret literals. Every `docker compose` command an agent runs passes `--env-file /dev/null` unless the user has approved a paid run, because compose reads `.env`, which holds a real key.
- New dependencies respect pnpm's release-age policy: pin an older version rather than excluding one.
