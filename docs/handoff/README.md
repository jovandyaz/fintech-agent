# Build handoff

Snapshot of where the build stands against `specs/04-build-plan.md`, for resuming in a new session. Written 2026-10-08.

## Where things are

All work is on `main`. Steps 0–7 and Task 9c are done.

Step 6 delivered (see `EVALS.md`):

- 24 labeled cases written before the first run, the code checkers, the promptfoo runner (`pnpm eval`), the report (`pnpm eval:report`, which re-grades the newest full run under the current checkers), the regression gate and `evals/baseline.json`;
- redactor recall on 20 strings the masker misses (20/20);
- the judge's 7 known-bad controls (all failed) and 62 blinded calibration rows in `evals/calibration/`, waiting for the user's labels;
- the first full comparison: **variant A**, with B out under rule 1 (26/30 attacks blocked).

Paid spend in Step 6 ≈ USD 12.81 of the USD 15 the user approved: three full runs (the first lost to a promptfoo clone bug, the second found the long-date fill bug) and the calibration export. No budget is left for another full run without asking.

Every commit passed `pnpm verify` on Node 24 and 22, and the integration suite on G-path commits.

`build-log/progress.md` is a copy of the ledger (`.superpowers/sdd/04-build-plan/progress.md`, git-ignored). Its `Ruling:` and `Owner:` lines are binding decisions and carried obligations. `build-log/step-*-plan.md` and `task-9c-plan.md` are the per-step plans. To resume on another machine, copy `build-log/*` into `.superpowers/sdd/04-build-plan/`.

## Remaining work

### Next, in the order the user chose (8 → 9 → 10)

| Step                               | Plan estimate | Outcome                                                                            |
| ---------------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| 8 Traces, alerts, variant decision | 45 min        | `ops/alerts.sql`, `ops/scan-logs.mjs`, the 03 decision rule (taken: A)             |
| 9 Docs                             | 70 min        | README (started), DESIGN, compliance appendix, EVALS, PLAYBOOK (Spanish), AI_NOTES |
| 10 Rehearsal                       | 15 min        | Outside the budget                                                                 |

Any paid run needs the user's direct confirmation.

### Waiting on the user

- Label `evals/calibration/to-label.jsonl` (README in that folder), then `pnpm eval:agreement` and `pnpm eval:report`: groundedness counts toward the decision only if the judge meets TPR ≥ 0.8 and TNR ≥ 0.9.

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
- **Step 6 → next prompt or harness change (needs a paid run to measure):**
  - `UNGROUNDED_NUMBER` exhausts the single repair in most model fallbacks (EVALS.md §Failures): a second repair turn for it only, or a prompt line to copy figures as the tool outputs print them; measure with `pnpm eval --only high-stakes`.
  - Haiku's first structured answer fails `SCHEMA` on 4 cases.
  - The injection scan did not flag a request to "answer in HTML" (`responde en HTML`), seen in the Step 7 review.
- **Known residual, decided by the user:** filled replies with three dates plus a model-written date-time cross the masker's 32-digit date cap and fall back (02 G5; pinned by `placeholders.spec.ts`).
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
