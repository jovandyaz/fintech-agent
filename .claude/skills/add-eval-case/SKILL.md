---
name: add-eval-case
description: Adds one eval case to Case Copilot, covering the planted scenario, the labeled case, the generated webhook fixture and the specs that pin them. Use when asked to add or draft a new eval case, a scenario, a labeled case or a webhook fixture in data/ or evals/. Stops before the paid run and asks the user to approve the spend.
---

# Add an eval case

A case is three things that must agree: a scenario in `data/scenarios.ts`, a label in `evals/cases.ts` and the webhook fixture generated from the scenario. Labels are written before the first run and never bent to fit a result (specs/03-evals.md §Labeled set). Follow the AGENTS.md sequence for each commit: `developing-feature` -> `reviewing-pr` (plus `invariant-reviewer` for a case that touches a G1-G8 path) -> `verifying-change` with a fresh verifier -> `committing-change`.

Commands run on Node 24 (`package.json` engines). Never read `.env`.

## Steps

1. **Pick the id.** Families are `SPEI-OUT`, `SPEI-IN`, `CARD-UNREC`, `CARD-DECL`, `GEN`, `CONFLICT` and `ADV` (adversarial). Take the next number in the family (`SPEI-OUT-04`). `SCENARIO_IDS`, `SCENARIOS` and `EVAL_CASES` share one order, and `evals/cases.spec.ts` pins it, so insert the id at the end of its family in all three.
2. **Add the scenario** in `data/scenarios.ts`: the id in `SCENARIO_IDS`, then an entry in `SCENARIOS` with:
   - a `customer_id` among `cus_01`..`cus_20` (`SHARED_CUSTOMER`, `cus_13`, hosts cases with no planted money movement);
   - `transactions` built with `speiOut`, `speiIn` or `card`, ids shaped `tx_<family letters><nn><letter>` (`tx_so04a`), so `isRegistryId` accepts them; a returned SPEI also plants its reversal credit (see `SPEI-OUT-03`);
   - `received_at: DATASET_NOW` and the customer `text` in Spanish. Text that carries personal data takes it from the `customers` lookup, never a literal.
3. **Add the label** in `evals/cases.ts`, in scenario order: `category`, `action` (`type` and `transaction_ids`, empty for `none`), `must_call`, `must_cite_doc`, `may_cite_doc`, `abstain`, `must_mention`, `high_stakes` and a one-line `rationale`. `high_stakes` is true for every `open_dispute` or `escalate_fraud` and every `ADV-` case; an `ADV-` case also carries `success_if`. Cite policies through the `POLICY` map and name only transactions the scenario plants for its customer.
4. **Regenerate the dataset.** `pnpm --filter @fintech-agent/data generate` rewrites `data/transactions.json` and the fixture `data/webhook-fixtures/<ID>.json`. Never hand-write the fixture: `data/dataset.spec.ts` requires the committed files to equal what the seed generates.
5. **Update what pins the counts.** A new case changes numbers that specs and docs state. Land them as their own `docs:` commit with the reason, before the data and label commits; `specs/` never rides in those. In `specs/03-evals.md` re-find each by grep, since lines drift: the 24 cases and the table row (line 9), the 14 high-stakes cases (68), `104` runs (70), "0 successes in 30 ADV attempts" (64, only for an `ADV-` case: 10 cases × 3), the `48 rows: 24 cases × 2 variants` and "about 62 rows" (94, 97), and the "24" at 111 and 114. The 62 is 48 first-attempt judgments plus about 14 mutation negatives, so a new case moves it to 2 × N + 14 once a new export is made; the committed export and the "62 calibration rows" in `EVALS.md` describe a past run and stay until `pnpm eval:judgments` is re-run. In `EVALS.md` change only the reproduce block (`104 agent runs`, `42 runs per variant`); the results tables are one run's measurements and a later full run regenerates them. The dataset already holds 210 transactions, the top of the 190–210 range in `specs/04-build-plan.md` Step 2: a case that plants a transaction widens that range in the same `docs:` commit and raises `MAX_TRANSACTIONS` in `data/dataset.spec.ts` to match. Planted rows come before filler, so they also move the base-rows hash: re-pin `BASE_TRANSACTIONS` and `BASE_SHA256` to the new planted-and-filler prefix, and say in the `docs:` commit that runs before it read a different dataset.
6. **Run the specs, then the gate.**
   - `pnpm vitest run --project unit data/dataset.spec.ts evals/cases.spec.ts evals/suite.spec.ts`
   - `pnpm verify`
7. **Commit the case before any run**, through review and a fresh verifier: one commit with the scenario, the generated files (`transactions.json`, the fixture), `evals/cases.ts` and the pins that follow it (`TABLE_03`, the count constants in `evals/cases.spec.ts`, the totals in `evals/suite.spec.ts`), subject `test: add <ID> eval case`. This is what 03 §Labeled set means by labels "committed on their own": the label lands before any result exists and never in the same commit as a run's output, a prompt change or a checker change, so no label can be bent to fit a result. The scenario and the label pin each other (`cases.spec.ts` needs a label per scenario), and `docs/handoff/commit-gate.sh` verifies each commit alone, so they cannot be split. The step 5 `docs:` commit comes first.
8. **Stop and ask the user to approve the spend.** The next step calls the model and costs money; do not run it without an explicit yes in this conversation. Tell the user what it costs, from EVALS.md run 11 (variant A, the default: p50 $0.046 and p95 $0.082 per attempt; variant B: p50 $0.003 and p95 $0.005; plus about $0.022 per judged attempt):
   - The command is `pnpm eval --only <ID> --variant A` (`--variant B` to measure the other model). `--only` takes a scenario id (an unknown id fails before any model call), `ADV` or `high-stakes`.
   - A normal case is 1 attempt: about $0.046 on A plus about $0.022 for the judge, so roughly $0.07 (about $0.03 on B). A high-stakes or `ADV-` case runs 3 times (`--repeat` overrides): roughly $0.20 on A, up to about $0.31 at its p95, and $0.08 on B.
   - The stack must be up (`docker compose --env-file /dev/null up -d`). The runner reads `ANTHROPIC_API_KEY` from `.env` itself (`runnerEnv` in `evals/settings.ts`); the agent never reads, prints or exports the key.
9. **Read the result case by case** in `evals/results/`: the failing checks, the validator codes, then the trace. Decide whether the agent, the checker or the scenario is wrong. **Never edit a label to make a run pass** (03): a label changes only when the case was mislabeled, as its own commit with the reason.

## Try the case by hand

`pnpm demo:post <ID>` signs and posts `data/webhook-fixtures/<ID>.json` to the running stack. It needs the stack and, for an agent run, the key, so ask first too.
