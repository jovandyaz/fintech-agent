# Task 2 — Tokens and finish reason per trace step

Read `common.md` first. Spec: the brief requires "trazas por caso … con tokens, costo y latencia por paso"; specs/04-build-plan.md §Step 8 Done when: "a case in the console shows tokens, cost and latency per step"; specs/01-architecture.md §Observability "Per step"; 02 G3 (the console must not let a canary be told apart); 02 G7 (plain text only).

## Current state

- `run_steps` (`apps/api/src/database/schema.ts:143-161`) already stores per step `input_tokens`, `output_tokens`, `cached_input_tokens`, `cost_usd`, `latency_ms`, `provider_request_id`, `finish_reason` (all nullable; only `llm` steps have tokens/finish reason).
- `StepViewSchema` (`packages/contracts/src/console.ts:60-68`) exposes only `idx, kind, name, input, output, latency_ms, cost_usd`.
- The read model (`apps/api/src/console/read-model.ts:133-141`) maps steps.
- `apps/console/src/cases/RunTrace.tsx` `Step` (≈ lines 32-63) renders kind, name, latency, cost, validator codes and a `<details>` with input/output; tokens appear only per run.
- No-tell test: `apps/api/src/console/console.int.spec.ts:375-403` compares `keyPathsOf` of a canary case detail with a real one.

## Required

1. `StepViewSchema` gains `input_tokens`, `output_tokens`, `cached_input_tokens` (`z.number().int().nullable()`) and `finish_reason` (`z.string().nullable()`). `provider_request_id` stays out of every DTO.
2. Read model maps the four fields.
3. `RunTrace` `Step`: when `input_tokens` or `output_tokens` is non-null, the step head shows `"<in> entrada · <out> salida"` with numbers formatted `es-MX` (e.g. `1,234`), plus `" · <cached> en caché"` only when cached > 0. The finish reason appears inside the `<details>` as a labeled line (`Fin: <reason>`), plain text. Steps with null tokens show no token text. Keep it plain text (G7: no `dangerouslySetInnerHTML`).
4. Tests (RED first):
   - read-model spec (unit or the existing console int spec, whichever already covers step mapping): the four fields round-trip from `run_steps`.
   - `RunTrace.spec.tsx`: an llm step shows `1,234 entrada · 56 salida`; with cached 800 also `· 800 en caché`; with cached 0 no "en caché"; a tool step with null tokens shows no "entrada"; finish reason shown in the details.
   - `console.int.spec.ts` no-tell test: make sure the canary case and the real case both include an `llm` step with token values, so the key-path comparison covers the new step keys (if `keyPathsOf` collapses arrays, assert the step key set explicitly for both).
5. Update any other consumer of `StepView` that typechecks against the schema (grep `StepView`, e2e fixtures in `e2e/`).

## Mutations to run

Drop one field from the read-model mapping; render the token text for a step with null tokens; show "en caché" when cached is 0. Each must fail a test.

## Files

`packages/contracts/src/console.ts`, `apps/api/src/console/read-model.ts` (+ spec), `apps/console/src/cases/RunTrace.tsx`, `apps/console/src/cases/RunTrace.spec.tsx`, `apps/api/src/console/console.int.spec.ts`, any fixture that builds a `StepView`.

Run the integration spec you touched: `fnm exec --using=24 -- pnpm vitest run --project integration apps/api/src/console`.
