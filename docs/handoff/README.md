# Build handoff

Snapshot of where the build stands against `specs/04-build-plan.md`, for resuming in a new session. Written 2026-10-10.

## Where things are

All work is on `main`. Steps 0–8 and Task 9c are done.

Step 8 delivered (plan: `build-log/step-8-plan.md`, briefs: `build-log/step-8/`):

- per-step tokens, cached tokens and finish reason in the console trace (the brief's "tokens, costo y latencia por paso");
- every table alert of 01 in `ops/alerts.sql`, the reject metric in `ops/metrics.sql` (override counts as `wrong_action`, canaries and eval cases out), each pinned by Testcontainers tests; run read-only as `copilot_api` (`ops/README.md`);
- `pnpm ops:scan-logs` and `pnpm ops:scan-traces`: the log alerts and both halves of the PII sink scan, with the masker itself as the oracle;
- the injection scan flags requests that dictate the reply's markup;
- canaries calibrated against the 52 recorded variant-A runs (parallel tool calls, ≈1/3 repairs, real-length text, 9 templates on 9 customers, 4 proposing `none`), closing Step 7's G3 Review Focus 4;
- the `add-eval-case` and `add-policy-doc` skills, and `pnpm eval --only <scenario id>` for the skill's single run;
- no OpenTelemetry exporter: own traces satisfy the brief; the masked OTel seam stays tested and unwired (01 §Observability).

Every commit passed `pnpm verify` on Node 24 and 22 and the integration suite where it applied. `pnpm e2e` ran green against a fresh stack with the kill switch at close-out.

`build-log/progress.md` is a copy of the ledger (`.superpowers/sdd/04-build-plan/progress.md`, git-ignored). Its `Ruling:` and `Owner:` lines are binding decisions and carried obligations. To resume on another machine, copy `build-log/*` into `.superpowers/sdd/04-build-plan/` and add `.superpowers/` to `.git/info/exclude`.

## Remaining work

### Next (9 → 10)

| Step         | Plan estimate | Outcome                                                                                                                                  |
| ------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 9 Docs       | 70 min        | README (started), DESIGN (incl. the residual canary tells and the Knowtis ports list), compliance appendix, PLAYBOOK (Spanish), AI_NOTES |
| 10 Rehearsal | 15 min        | Outside the budget                                                                                                                       |

Any paid run needs the user's direct confirmation.

### Waiting on the user

- Label `evals/calibration/to-label.jsonl` (README in that folder), then `pnpm eval:agreement` and `pnpm eval:report`: groundedness counts toward the decision only if the judge meets TPR ≥ 0.8 and TNR ≥ 0.9.

### Paid follow-up bolt (needs a budget)

- `UNGROUNDED_NUMBER` exhausts the single repair in most model fallbacks: a second repair turn for it only, or a prompt line to copy figures as the tools print them; measure with `pnpm eval --only high-stakes`.
- Haiku's first structured answer fails `SCHEMA` on 4 cases.
- An ADV case for category steering on a 1-factor charge (Step 4d owner); the lexical families the validator does not read and the `COMMITMENT_IN_REPLY` imperative false positives, as eval cases.

### Carried owners

- **Step 9:** the seed role password could appear in a Postgres `STATEMENT` log line if the `ALTER ROLE` ever errored — ticket it or silence that session's statement logging; the full README per 04 §Step 9; DESIGN.md's residual-risk table names the canary tells left (no fallbacks, always 3 tool calls, drafts repeat across batches) and the scan limits in `ops/README.md`.
- **Known residual, decided by the user:** filled replies with three dates plus a model-written date-time cross the masker's 32-digit date cap and fall back (02 G5; pinned by `placeholders.spec.ts`).

## Working rules that are easy to lose

- Every behavior change follows the AGENTS.md sequence: `developing-feature` → `reviewing-pr` + `invariant-reviewer` (read-only) → `verifying-change` with a fresh verifier → `committing-change`.
- Commits:
  - one line, ≤ 72 chars, Conventional Commits, no trailers;
  - never squash, amend or force push;
  - a spec change is its own `docs:` commit.
- Commit through `docs/handoff/commit-gate.sh "<subject>" [--int] <paths>`. It stashes everything else, so verify sees only what is committed: never run it while an agent is editing the tree, and never `git add -N` before it.
- Node: run through `fnm exec --using=24 -- …`; the machine default is 22, and both must pass.
- Never read `.env` or `.env.*.local`; no secret literals. Every `docker compose` command an agent runs passes `--env-file /dev/null` unless the user has approved a paid run, because compose reads `.env`, which holds a real key.
- New dependencies respect pnpm's release-age policy: pin an older version rather than excluding one.
