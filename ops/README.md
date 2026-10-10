# ops

The alerts over tables (`alerts.sql`) and the dashboard queries (`metrics.sql`) of [specs/01-architecture.md §Observability](../specs/01-architecture.md#observability). The alerts over log lines and the PII sink scan are TypeScript scanners in `apps/api/src/ops/`.

Each block starts with `-- name: <query>` and returns one row per firing alert; no row means quiet. A block that lists executions, operators, disputes or security events gives one row each, keyed by its first column; the others give one row for the whole alert. `apps/api/test/alerts.int.spec.ts` pins every block.

## Running a block

The api role can read every table the blocks use, and can also write; `default_transaction_read_only` makes the session refuse any write, so the blocks run strictly read-only. One block, by name:

```sh
awk -v name=oldest_queued '/^-- name: /{on = ($3 == name)} on' ops/alerts.sql \
  | PGOPTIONS='-c default_transaction_read_only=on' psql "$API_DATABASE_URL" -v ON_ERROR_STOP=1
```

`PGOPTIONS='-c default_transaction_read_only=on' psql "$API_DATABASE_URL" -v ON_ERROR_STOP=1 -f ops/alerts.sql` runs them all, one result per block. Code splits the file on `^-- name: ` the same way (`query()` in the spec).

A block reads "now" from the setting `alerts.now` when it is set, else `now()`, so a replay or a test fixes the clock on its connection first:

```sql
select set_config('alerts.now', '2026-10-13T00:01:00-06:00', false);
```

`metrics.sql` takes its window from `metrics.window` (an interval, default `7 days`) the same way.

## Cadence and owners

The scheduler runs each alert every 5 minutes, and hourly the ones over a day or more, and deduplicates on the row key: a 15-minute window sees each security event in three runs. Thresholds are starting points to recalibrate against the first weeks of shadow data (01).

| Block                                | Threshold                                                                                                                                                                      | Minimum sample              | Every | Owner                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ----- | -------------------------------------- |
| `execution_without_decision`         | Any execution whose proposal has no `decided_by` or `decided_at` or a status other than `approved`, `executed`, `failed`, and any execution of a canary or an eval case        | None                        | 5 min | Page: on-call + security               |
| `canary_catch_rate`                  | < 100% over the operator's last 20 canaries                                                                                                                                    | None                        | 5 min | Ticket: ops lead (coaching, not blame) |
| `open_dispute_overdue`               | `open_dispute` still `proposed` after the first business day after the Mexico City date of `received_at`; weekends skipped, holidays not modeled (a holiday pages a day early) | None                        | 5 min | Page: ops lead                         |
| `oldest_queued`                      | A queued case due for > 15 min                                                                                                                                                 | None                        | 5 min | Page: on-call                          |
| `fallback_or_provider_error_rate`    | > 10% of finished runs over 30 min in `fallback` or `failed`; the kill switch's `agent_disabled` runs do not count                                                             | 10 runs                     | 5 min | Page: on-call                          |
| `reply_quality_regression`           | Rejected, approved with `reply_edit_ratio` > 0.3, or overridden: share over 7 days > the prior 28 days' share + 10 pp                                                          | 20 decisions in each window | 1 h   | Ticket: AI lead                        |
| `injection_or_validation_block_rate` | Share of finished runs over 24 h with `injection_signal` or stopped on `validation` > 3× the median of the 7 previous daily shares                                             | 10 runs                     | 1 h   | Ticket: AI lead + security             |
| `cost_per_case_p95`                  | p95 cost per case received in 24 h > 2× the p95 of the 7 days before                                                                                                           | 20 cases on each side       | 1 h   | Ticket: AI lead                        |
| `cross_customer_lookup`              | Any `cross_customer_lookup` security event in 15 min                                                                                                                           | None                        | 5 min | Ticket: security                       |
| `redactor_degraded`                  | > 5% of intakes over 1 h with a `degraded` redaction step                                                                                                                      | 20 intakes                  | 5 min | Ticket: AI lead                        |

Every block that joins `cases` leaves eval cases (`source = 'eval'`) out, except `execution_without_decision`, where any execution of one is the breach; `canary_catch_rate` needs no such join, as an eval case is never a canary. Canaries count only in `canary_catch_rate` and where a row is the breach or the queue's health: `execution_without_decision`, `oldest_queued`, `cross_customer_lookup`.
