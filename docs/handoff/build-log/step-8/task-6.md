# Task 6 — Canaries that read like real runs (02 G3 Review Focus 4)

Read `common.md` first. Spec: specs/02-security.md G3 "Canary proposals" bullet (as amended by the orchestrator's `docs(specs)` commit before this task: one case per template, a defect may have several templates, so a batch's action mix tracks the agent's; a scripted run may repair once; metrics vary around real runs). Ledger owner lines to close (Step 7 review F3 and the calibration owners): real runs call several tools in one model step, canaries one per step; real runs repair (17/52), canaries never; real justification/reasoning/drafts run to paragraphs, canaries' are one sentence; canaries propose actions where real runs mostly propose `none` (28/52); repeated canary texts; id shapes (`req_`/`toolu_` without the provider's `011C`/`01` prefixes); `list_transactions` called with `{}` where real runs always filter.

Code: `apps/api/src/canaries/script.ts` (scripted v4 model: `investigationOf`, `resolutionOf`, `canaryModelsOf`, token/latency ranges), `templates.ts` (`CANARY_DEFECTS`, `CANARY_TEMPLATES`, `canaryTemplateOf`), `inject.ts` (`injectCanaries`: one case per template, shuffled, spread), their specs, `canary-run.e2e.spec.ts`, and `apps/api/src/console/console.int.spec.ts` no-tell tests. Find how the worker picks a canary's template (`canaryTemplateOf(defect)` callers) — with several templates per defect, the `canary_cases` row must identify the template (see step 6b.3).

Reference data (do not re-derive; you may read the file to check): `evals/results/2026-10-08-0576343-140923Z.json`, the 52 `variant-A` runs (`results[].response.metadata.run`):

- run totals: input tokens 9,919–30,610 (q1 15,454, median 15,911, q3 22,442); output 649–3,108 (q1 1,195, median 1,412, q3 2,232); latency 8,803–37,674 ms (median 14,225); cost US$0.026–0.082 (median 0.0447); `steps` (all kinds) 7–14, median 10; MCP tool calls 1–5, median 3 (search_policies is a `retrieval` step, not counted there).
- sequences: get_customer + list_transactions + get_card_authorization (26); + get_spei_status (11); get_customer only (8); others with repeated lookups.
- `list_transactions` inputs always filtered: `{query,type}`, `{query}`, `{min_amount,max_amount,type}`, `{limit,query,type}`, `{limit,type}`, `{from,to,type}`, `{limit,status}`…
- model outputs: `reasoning_summary` 202–492 chars (median 331); `justification` 138–380 (median 229); `draft_reply` 289–846 (median 580), greeting by name, amount and date as tools print them, policy in plain words, Spanish.
- 17/52 runs had a repair (2 validations); 7/52 fell back.
- actions: none 28, open_dispute 15, resend_cep 6, escalate_fraud 3.

## 6a — scripted model

1. New `apps/api/src/canaries/real-runs.ts`: the envelope above as named constants, with a header comment naming the results file and commit `0576343`.
2. `script.ts` changes:
   - First agent step: a short Spanish prose text part plus two tool calls in the same step: `get_customer {}` and `list_transactions` with filters derived from the seed (e.g. `{type, query}` from the template's category/merchant, or `{min_amount,max_amount,type}`).
   - Lookups: all of a seed's lookups in one step (parallel tool calls), with a prose lead-in.
   - Policy searches: in one step, with a natural `query` (not just the section title verbatim — use a phrase), keep `doc_id` if the real tool accepts it.
   - Repair: with probability ≈ 17/52 per run (seeded through `pacing.random`), the first final answer is the template resolution with one repairable defect the validator catches (an amount absent from tool data in `draft_reply` → `UNGROUNDED_NUMBER`); the repair turn then answers the clean template resolution. Confirm by test that the validator's repair path is what consumes it (run through the real harness in the e2e spec).
   - Ids: request ids `req_011C` + 20 chars, tool call ids `toolu_01` + 22 chars (check the alphabets against the shapes in real eval data if present, else Anthropic's documented shapes).
   - Token / latency ranges recalibrated so run totals land inside the envelope.
3. Tests (RED first): over 200 seeded runs per template (sleep stubbed), run totals (input, output, latency) and step counts fall within the envelope's min–max and their medians within the real q1–q3; text lengths within min–max; the first step holds both calls; repair share between 20% and 45% over 200 runs; ids match the shapes.

## 6b — templates and injection

1. Rewrite each template's `draftReply` (inside 289–846 chars, using `{{nombre}}`, `{{folio}}`, `{{compromiso_dictamen}}` where the action calls for them, amounts/dates as tool outputs print them), `reasoningSummary` (202–492) and `action.justification` (138–380), in the voice of real drafts. Each template's `text` becomes an array of ≥ 3 phrasings; injection picks one with `pacing.random`.
2. Add three `none_on_disputable` templates on existing scenario data (find suitable customers/transactions in `data/scenarios.ts` / `data/transactions.json` — each id must exist and belong to the customer): a SPEI sent and still unreceived past its window answered as informational `none`; a social-engineering/fraud report answered `none` instead of `escalate_fraud`; a card charge the customer disputes answered `none` as "liquidado". With 9 templates, 4 propose `none` (≈ 44%, vs 54% real).
3. Template identity: `canary_cases` stores `defect` (CHECK over `CANARY_DEFECTS`). Do not change the defect list or the CHECK. Pick the smallest correct way for the worker to replay the right template: e.g. a stable template key carried in the case (if a `template` column is needed, that is a migration — prefer deriving the template deterministically from data already stored, such as the case's customer and text matching one template's phrasing set; if no clean option exists, stop and report NEEDS_CONTEXT with the options).
4. Every template passes the full validator with no codes, and its `flags` equal what Persist computes (extend `templates.spec.ts` as it already does).
5. `wrong_category` keeps its card lookup under a SPEI category — that mismatch is the defect itself.
6. `injectCanaries` posts one case per template (9).
7. Re-run `canary-run.e2e.spec.ts`, `inject.int.spec.ts`, `console.int.spec.ts`.

## Mutations

Serialize the first step's two calls; set repair probability to 0; constant ids; drop the `none` templates from the batch; reuse one phrasing.

## Files

`apps/api/src/canaries/*` (+ specs), `apps/api/src/console/console.int.spec.ts` if the no-tell fixtures need the new shapes. Report the before/after of one canary trace (step list with kinds, tool names, token counts) in your report.

## Added from Task 2 invariant review

- Value parity of per-step fields now shown in the console: a canary's llm steps must carry the same `finish_reason` values real runs store (AI SDK unified `tool-calls` / `stop`), `cached_input_tokens` 0 like real runs (no cacheControl), and the same null pattern on guard/redaction steps. Add a test comparing one scripted run's step rows with a real-run fixture shape (kinds, finish reasons, null pattern).
