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

| Block                                | Threshold                                                                                                                                                                                                                                               | Minimum sample              | Every | Owner                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----- | -------------------------------------- |
| `execution_without_decision`         | Any execution whose proposal has no `decided_by`, one that is not an `operator:` actor, no `decided_at` or a status other than `approved`, `executed`, `failed`, and any execution of a `none`, a canary (flagged or in `canary_cases`) or an eval case | None                        | 5 min | Page: on-call + security               |
| `canary_catch_rate`                  | < 100% over the operator's last 20 canaries                                                                                                                                                                                                             | None                        | 5 min | Ticket: ops lead (coaching, not blame) |
| `open_dispute_overdue`               | `open_dispute` still `proposed` after the first business day after the Mexico City date of `received_at`; weekends skipped, holidays not modeled (a holiday pages a day early)                                                                          | None                        | 5 min | Page: ops lead                         |
| `oldest_queued`                      | A queued case due for > 15 min, or an `investigating` one whose lease (`locked_until`) ran out > 15 min ago (a dead worker)                                                                                                                             | None                        | 5 min | Page: on-call                          |
| `fallback_or_provider_error_rate`    | > 10% of finished runs over 30 min in `fallback` or `failed`; the kill switch's `agent_disabled` runs do not count                                                                                                                                      | 10 runs                     | 5 min | Page: on-call                          |
| `reply_quality_regression`           | Rejected, approved with `reply_edit_ratio` > 0.3, or overridden: share over 7 days > the prior 28 days' share + 10 pp                                                                                                                                   | 20 decisions in each window | 1 h   | Ticket: AI lead                        |
| `injection_or_validation_block_rate` | Share of finished runs over 24 h with `injection_signal` or stopped on `validation` > 3× the median of the 7 previous daily shares                                                                                                                      | 10 runs                     | 1 h   | Ticket: AI lead + security             |
| `cost_per_case_p95`                  | p95 cost per case received in 24 h > 2× the p95 of the 7 days before                                                                                                                                                                                    | 20 cases on each side       | 1 h   | Ticket: AI lead                        |
| `cross_customer_lookup`              | Any `cross_customer_lookup` security event in 15 min                                                                                                                                                                                                    | None                        | 5 min | Ticket: security                       |
| `redactor_degraded`                  | > 5% of intakes over 1 h with a `degraded` redaction step                                                                                                                                                                                               | 20 intakes                  | 5 min | Ticket: AI lead                        |

Every block that joins `cases` leaves eval cases (`source = 'eval'`) out, except `execution_without_decision`, where any execution of one is the breach; `canary_catch_rate` needs no such join, as an eval case is never a canary. Canaries count only in `canary_catch_rate` and where a row is the breach or the queue's health: `execution_without_decision`, `oldest_queued`, `cross_customer_lookup`.

## Scanners

The log-line alerts and the PII sink scan judge a value by the masker itself, so the exempt runs of 02 G6 (dates, amounts, folios, last-4…) never fire: a text is clean when `hasPii` finds nothing (`maskPii`'s own test, so folding an ellipsis or a no-break space is not a hit), and a JSON value when every text, key and number in it is, except what `maskJson` keeps verbatim (a UUID under an id key, an epoch under a time key). A slot `maskJson` replaces whole, an auth factor such as `otp`, `pin` or a `{name: 'cvv', value}` pair, is a hit unless it already holds a marker (`[factor]`, or the logger's `[redacted]`). A value the masker cannot read, such as JSON nested too deep, counts as a hit for its line or row, and the scan goes on. Each prints one JSON line per alert on stdout (the shapes are `LogAlertSchema` and `TraceAlertSchema` in `packages/contracts`) and never the content it flagged.

What the scans cannot see: a number split across several keys or values with fewer than 8 digits each; the earlier of two duplicate JSON keys, as parsing keeps the last; and a float with 8 or more digits in all (`1234.5678`, `0.1234567`) counts as a hit even when it is a measurement, failing closed; the api's writers round floats to 6 significant digits, so only a line that skipped `maskJson` holds one.

```sh
COMPOSE_DISABLE_ENV_FILE=1 docker compose logs --no-log-prefix --no-color --since 10m api mcp executor \
  | pnpm ops:scan-logs
pnpm ops:scan-traces                                   # the last 24 h
pnpm ops:scan-traces --since 2026-10-10T00:00:00-06:00
```

`ops:scan-logs` reads the whole of stdin before it answers, which is fine for minutes of logs, not for days. A line that is not JSON (Postgres, nginx, a line cut mid-write) is scanned as text. `ops:scan-traces` reads `API_DATABASE_URL`, with the dev default from `.env.example` on the host, as `canary:inject` does.

| Alert                       | Fires on                                                                                                                                                                           | Every | Owner            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------- |
| `pii_in_logs`               | Any log line holding a value the masker would still mask; gives `line` and, for a JSON line, its `at`                                                                              | 5 min | Page: security   |
| `security_event_unrecorded` | Any MCP line with that event: a `cross_customer_lookup` the sink failed to write, so a fraud signal is lost                                                                        | 5 min | Page: security   |
| `auth_rejected_burst`       | > 10 `auth_rejected` lines whose `timestamp` falls in any 5 minutes; one alert per burst with its first `line`, `at` and `count`; a line without a readable `timestamp` joins none | 5 min | Ticket: security |
| Trace hit                   | Any stored value the masker would still mask, given as `{table, column, key}`, over the columns of 01 written since `--since`; eval cases and canaries included, a leak is a leak  | 1 h   | Page: security   |

The log scan reads 10 minutes every 5, so a burst that straddles two runs is still seen whole; the scheduler deduplicates on the alert and its `at` (log) or its `key` (traces). A `pii_in_logs` on a line that is not JSON has no `at`, so it may page twice across overlapping reads; that is accepted for a security page. Exit codes: `0` no alert, `1` alerts printed, `2` the scan could not run: a bad argument (`ops:scan-logs` takes none, `ops:scan-traces` only `--since` with an ISO instant carrying `Z` or an offset) or an unreachable database, told in one short masked `scan_failed` line on stderr. The root `pnpm ops:*` scripts run through `pnpm --filter`, which reports a `2` as `1`; a scheduler that needs the difference runs the script from `apps/api` (`pnpm --dir apps/api ops:scan-traces`) or `node --import tsx` directly.
