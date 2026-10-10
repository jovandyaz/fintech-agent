-- Alert queries over the tables of specs/01-architecture.md §Observability, one
-- per block; ops/README.md says how to run them, how often and who owns each.
-- Each block starts with "-- name: <query>" and returns one row per firing alert.
-- A block with a time window reads "now" from the setting alerts.now when it is
-- set (a replay, a test), else now(). Every block that joins cases leaves eval
-- cases out, except execution_without_decision, where any execution of one is the
-- breach; canary_catch_rate needs no such join, as an eval case is never a canary.
-- Canaries count only in canary_catch_rate and where a row is itself the breach
-- or the queue's health (an execution, a stuck queue, a security event).

-- name: canary_catch_rate
-- Canary catch rate per operator < 100% over that operator's last 20 canaries.
-- Minimum sample: none. Owner: ticket ops lead (coaching, not blame).
with decided as (
  select
    decided_by as operator,
    status,
    row_number() over (partition by decided_by order by decided_at desc, id desc) as recency
  from proposed_actions
  where is_canary and status in ('canary_caught', 'canary_missed')
)
select
  operator,
  count(*) filter (where status = 'canary_caught') as caught,
  count(*) as decided
from decided
where recency <= 20
group by operator
having count(*) filter (where status = 'canary_caught') < count(*)
order by operator;

-- name: execution_without_decision
-- Any action_executions row whose proposal lacks an operator decision: no
-- decided_by, no decided_at, or a status an approval never reaches (02 G3); and
-- any execution of a canary or an eval case, decided or not, since neither may
-- ever execute. Minimum sample: none. Deduplicate by action_id.
-- Owner: page on-call + security.
select e.action_id, p.case_id, p.status
from action_executions e
join proposed_actions p on p.id = e.action_id
join cases c on c.id = p.case_id
where p.decided_by is null
   or p.decided_at is null
   or p.status not in ('approved', 'executed', 'failed')
   or p.is_canary
   or c.source = 'eval'
order by e.action_id;

-- name: open_dispute_overdue
-- An open_dispute still proposed after the end of the first business day after
-- the Mexico City date of received_at (the 18.a credit is due on the 2nd).
-- Saturdays and Sundays are skipped; holidays are not modeled in SQL, so a
-- holiday pages a day early, the safe side. Minimum sample: none. Excludes eval
-- cases and canaries. Owner: page ops lead.
with clock as (
  select coalesce(nullif(current_setting('alerts.now', true), '')::timestamptz, now()) as now
),
open_disputes as (
  select
    p.id as action_id,
    p.case_id,
    (c.received_at at time zone 'America/Mexico_City')::date as received_on
  from proposed_actions p
  join cases c on c.id = p.case_id
  where p.type = 'open_dispute'
    and p.status = 'proposed'
    and not p.is_canary
    and c.source <> 'eval'
),
deadlines as (
  select
    action_id,
    case_id,
    -- Three days reach Monday from a Friday, the longest wait for a weekday.
    (
      (select min(received_on + days)
       from generate_series(1, 3) as days
       where extract(isodow from received_on + days) < 6) + 1
    )::timestamp at time zone 'America/Mexico_City' as deadline
  from open_disputes
)
select action_id, case_id, deadline
from deadlines
cross join clock
where clock.now > deadline
order by deadline, action_id;

-- name: oldest_queued
-- A queued case has been due (next_attempt_at) for more than 15 minutes; the row
-- counts them and gives the oldest due time. Minimum sample: none. Excludes eval
-- cases, which the eval runner claims by id and no worker takes.
-- Owner: page on-call.
with clock as (
  select coalesce(nullif(current_setting('alerts.now', true), '')::timestamptz, now()) as now
)
select count(*) as overdue, min(c.next_attempt_at) as oldest_due
from cases c
cross join clock
where c.status = 'queued'
  and c.source <> 'eval'
  and clock.now - c.next_attempt_at > interval '15 minutes'
having count(*) > 0;

-- name: fallback_or_provider_error_rate
-- More than 10% of the finished runs started in the last 30 minutes ended in
-- fallback or failed. The kill switch's runs (stop_reason agent_disabled) do not
-- count: with AGENT_MODE=off every run is a fallback by design, and the console
-- banner already says so. Minimum sample: 10 runs. Excludes eval and canary
-- cases. Owner: page on-call.
with clock as (
  select coalesce(nullif(current_setting('alerts.now', true), '')::timestamptz, now()) as now
),
runs as (
  select r.status in ('fallback', 'failed') as failing
  from agent_runs r
  join cases c on c.id = r.case_id
  cross join clock
  where r.started_at > clock.now - interval '30 minutes'
    and r.started_at <= clock.now
    and r.status <> 'running'
    -- An abandoned run has no stop reason and still counts.
    and r.stop_reason is distinct from 'agent_disabled'
    and c.source <> 'eval'
    and not exists (select 1 from canary_cases k where k.case_id = c.id)
)
select count(*) as runs, count(*) filter (where failing) as failing
from runs
having count(*) >= 10
  and count(*) filter (where failing) > 0.10 * count(*);

-- name: reply_quality_regression
-- The share of poor decisions over the last 7 days is more than 10 points above
-- the same share over the 28 days before. Poor: rejected, approved with
-- reply_edit_ratio > 0.3 (a heavy edit is a silent rejection) or overridden
-- (02 G3). Minimum sample: 20 decisions in each window, else quiet. Excludes
-- eval cases and canaries. Owner: ticket AI lead.
with clock as (
  select coalesce(nullif(current_setting('alerts.now', true), '')::timestamptz, now()) as now
),
decisions as (
  select
    p.decided_at > clock.now - interval '7 days' as recent,
    -- As real, the column's type: against a numeric 0.3 both widen to double,
    -- where a stored 0.3 reads as more than 0.3.
    p.status = 'rejected' or p.reply_edit_ratio > real '0.3' or p.operator_override as poor
  from proposed_actions p
  join cases c on c.id = p.case_id
  cross join clock
  where p.status in ('approved', 'executed', 'failed', 'rejected')
    and p.decided_at > clock.now - interval '35 days'
    and p.decided_at <= clock.now
    and not p.is_canary
    and c.source <> 'eval'
),
windows as (
  select
    count(*) filter (where recent) as decisions,
    count(*) filter (where recent and poor) as poor,
    count(*) filter (where not recent) as prior_decisions,
    count(*) filter (where not recent and poor) as prior_poor
  from decisions
)
select decisions, poor, prior_decisions, prior_poor
from windows
where decisions >= 20
  and prior_decisions >= 20
  -- Postgres may test this before the samples above, so a zero count is a null.
  and poor::numeric / nullif(decisions, 0) > prior_poor::numeric / nullif(prior_decisions, 0) + 0.10;

-- name: injection_or_validation_block_rate
-- The share of runs over the last 24 hours whose case carries injection_signal or
-- that stopped on validation is more than 3 times the median of the 7 previous
-- daily shares. A day without runs has no share; with no previous share the alert
-- stays quiet, and with a zero median any blocked run fires. Only finished runs
-- count; the kill switch's agent_disabled runs do, as its intake scan still sets
-- injection_signal. Minimum sample: 10 runs in the last 24 hours. Excludes eval
-- and canary cases.
-- Owner: ticket AI lead + security.
with clock as (
  select coalesce(nullif(current_setting('alerts.now', true), '')::timestamptz, now()) as now
),
runs as (
  select
    floor(extract(epoch from clock.now - r.started_at) / 86400)::int as days_ago,
    c.flags ? 'injection_signal' or r.stop_reason = 'validation' as blocked
  from agent_runs r
  join cases c on c.id = r.case_id
  cross join clock
  where r.started_at > clock.now - interval '8 days'
    and r.started_at <= clock.now
    and r.status <> 'running'
    and c.source <> 'eval'
    and not exists (select 1 from canary_cases k where k.case_id = c.id)
),
daily as (
  select days_ago, count(*) as runs, count(*) filter (where blocked) as blocked
  from runs
  group by days_ago
),
ranked as (
  select
    blocked::numeric as blocked,
    runs::numeric as runs,
    row_number() over (order by blocked::numeric / runs) as position,
    count(*) over () as days
  from daily
  where days_ago between 1 and 7
),
-- The median is (a/b + c/d) / 2 over the two middle shares, the same share twice
-- for an odd count. It stays a fraction because any decimal form of 1/9 or 1/3
-- is rounded, and rounding makes a day at exactly 3 times the median fire.
baseline as (
  select
    min(blocked) filter (where position = (days + 1) / 2) as a,
    min(runs) filter (where position = (days + 1) / 2) as b,
    min(blocked) filter (where position = days / 2 + 1) as c,
    min(runs) filter (where position = days / 2 + 1) as d
  from ranked
)
select
  today.runs,
  today.blocked,
  round((a / b + c / d) / 2, 4) as baseline_share
from daily today
cross join baseline
where today.days_ago = 0
  and today.runs >= 10
  -- blocked / runs > 3 × (a/b + c/d) / 2, multiplied out over positive counts.
  and 2 * today.blocked * b * d > 3 * today.runs * (a * d + c * b);

-- name: cost_per_case_p95
-- The p95 of cost per case (the sum of its runs' cost_usd) over the cases received
-- in the last 24 hours is more than twice the p95 over the cases received in the
-- 7 days before. Minimum sample: 20 cases on each side, else quiet. Excludes eval
-- and canary cases. Owner: ticket AI lead.
with clock as (
  select coalesce(nullif(current_setting('alerts.now', true), '')::timestamptz, now()) as now
),
case_costs as (
  select c.received_at > clock.now - interval '1 day' as recent, sum(r.cost_usd) as cost_usd
  from cases c
  join agent_runs r on r.case_id = c.id
  cross join clock
  where c.received_at > clock.now - interval '8 days'
    and c.received_at <= clock.now
    and c.source <> 'eval'
    and not exists (select 1 from canary_cases k where k.case_id = c.id)
  group by c.id, recent
),
windows as (
  select
    count(*) filter (where recent) as cases,
    (percentile_cont(0.95) within group (order by cost_usd) filter (where recent))::numeric as p95,
    count(*) filter (where not recent) as prior_cases,
    (percentile_cont(0.95) within group (order by cost_usd) filter (where not recent))::numeric as prior_p95
  from case_costs
)
select cases, p95, prior_cases, prior_p95
from windows
where cases >= 20
  and prior_cases >= 20
  and p95 > 2 * prior_p95;

-- name: cross_customer_lookup
-- A cross_customer_lookup security event in the last 15 minutes: a run asked the
-- MCP server for another customer's transaction (02 G4). Minimum sample: none.
-- Excludes eval cases, whose adversarial scenarios cause them on purpose. Three
-- 5-minute runs see each event; deduplicate the ticket by id.
-- Owner: ticket security.
with clock as (
  select coalesce(nullif(current_setting('alerts.now', true), '')::timestamptz, now()) as now
)
select s.id, s.case_id, s.run_id, s.at
from security_events s
join cases c on c.id = s.case_id
cross join clock
where s.kind = 'cross_customer_lookup'
  and s.at > clock.now - interval '15 minutes'
  and s.at <= clock.now
  and c.source <> 'eval'
order by s.at, s.id;

-- name: redactor_degraded
-- More than 5% of the intakes over the last hour have a degraded redaction guard
-- step (the redactor errored or timed out, 01 §Failure handling); a step has no
-- time of its own, so its run's start dates it. Minimum sample: 20 intakes.
-- Excludes eval and canary cases. Owner: ticket AI lead.
with clock as (
  select coalesce(nullif(current_setting('alerts.now', true), '')::timestamptz, now()) as now
),
intakes as (
  select s.output_masked ->> 'outcome' = 'degraded' as degraded
  from run_steps s
  join agent_runs r on r.id = s.run_id
  join cases c on c.id = r.case_id
  cross join clock
  where s.kind = 'guard'
    and s.name = 'redaction'
    and r.started_at > clock.now - interval '1 hour'
    and r.started_at <= clock.now
    and c.source <> 'eval'
    and not exists (select 1 from canary_cases k where k.case_id = c.id)
)
select count(*) as intakes, count(*) filter (where degraded) as degraded
from intakes
having count(*) >= 20
  and count(*) filter (where degraded) > 0.05 * count(*);
