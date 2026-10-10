# Task 3 — Table alerts and the reject metric

Read `common.md` first. Spec: specs/01-architecture.md §Observability, the alert table (binding thresholds, minimum samples, owners); 02 G3 (override counts as `reject_code = wrong_action` in quality metrics; canaries excluded). The plan's Task 3 table (`step-8-plan.md`) is the rule for each query — follow it exactly.

## Existing pattern

- `ops/alerts.sql` holds one block, `canary_catch_rate`. Blocks start with `-- name: <query>` then comment lines (rule, `Owner:`), and return one row per firing alert.
- `apps/api/test/alerts.int.spec.ts` starts Postgres with Testcontainers (`startTestDatabase`, `insertCase` from `apps/api/test/database.ts`), splits the file by name with `query(name)`, inserts fixtures as the owner role (it disables trigger `enforce_transition_role` while planting decided proposals), and runs each block with `owner.unsafe(...)`.
- Schema: `apps/api/src/database/schema.ts` (`cases` incl. `source`, `status`, `received_at`, `next_attempt_at`, `flags` jsonb; `agent_runs` incl. `status`, `stop_reason`, `cost_usd`, `started_at`; `run_steps` (`kind`, `name`, `output_masked`); `proposed_actions` incl. `type`, `status`, `is_canary`, `decided_by`, `decided_at`, `reject_code`, `reply_edit_ratio`, `operator_override`; `action_executions`; `security_events` (`kind`, `at`)). Enums: `packages/contracts/src/states.ts`, `schemas.ts`. Guard step names: `redaction` (outcome in `output_masked->>'outcome'`: passed/flagged/degraded), `injection_scan`.

## Required

1. Nine new blocks in `ops/alerts.sql`, one per row of the plan's table: `execution_without_decision`, `open_dispute_overdue`, `oldest_queued`, `fallback_or_provider_error_rate`, `reply_quality_regression`, `injection_or_validation_block_rate`, `cost_per_case_p95`, `cross_customer_lookup`, `redactor_degraded`. Each has comment lines for its rule, minimum sample and `Owner:` (page/ticket as in 01).
2. Clock: every block reads its "now" as `coalesce(nullif(current_setting('alerts.now', true), '')::timestamptz, now())` so tests can fix time with `select set_config('alerts.now', $1, false)` on a dedicated connection. Keep the expression in one CTE per block (`with clock as (...)`).
3. Exclusions: every block except `canary_catch_rate` ignores `cases.source = 'eval'`; decision/proposal-based blocks ignore `is_canary`. Per case cost = sum of its runs' `cost_usd`.
4. `open_dispute_overdue`: deadline = end of the first business day after the Mexico City date of `received_at` (`America/Mexico_City`), skipping Saturday and Sunday. Holidays are not modeled in SQL (a holiday pages a day early — the safe side); state that in the block comment.
5. `ops/metrics.sql` (new): `-- name: rejects_by_code` — decided (`rejected`, `approved`, `executed`, `failed`) non-canary, non-eval proposals in a window (default last 7 days, same clock), effective code `case when operator_override then 'wrong_action' else reject_code end`, counted per code, rejects and overrides only (an approved proposal without override has no code).
6. `ops/README.md` (new, short): how to run a block (`psql "$API_DATABASE_URL" -f` with the name split, or the test's `query()` approach), the cadence each block assumes (every 5 min; daily-window blocks hourly), and a table name → threshold → owner → page/ticket, mirroring 01.
7. Tests in `alerts.int.spec.ts` (and `metrics` in the same file or a sibling `metrics.int.spec.ts` sharing helpers): per block a firing fixture, a quiet fixture, and for rate blocks the `n − 1` case and a planted eval-case row (and canary row where relevant) that would fire it if counted. `open_dispute_overdue`: a case received Friday 10:00 Mexico City is quiet Saturday, Sunday and Monday 23:59, fires Tuesday 00:01 local. Keep fixtures per describe isolated (separate case ids, or truncate between describes) so blocks don't see each other's rows.

## Mutations to run (at least)

Drop the eval exclusion in one rate block; change a threshold comparator (`>` to `>=`) where a boundary test exists; drop the weekend skip; count canaries in `rejects_by_code`; drop the minimum-sample clause. Each must fail a test.

## Files

`ops/alerts.sql`, `ops/metrics.sql`, `ops/README.md`, `apps/api/test/alerts.int.spec.ts` (+ optional `metrics.int.spec.ts`, shared helpers in `apps/api/test/` if needed).

Run: `fnm exec --using=24 -- pnpm vitest run --project integration apps/api/test/alerts.int.spec.ts` (and metrics spec), then `pnpm verify`.
