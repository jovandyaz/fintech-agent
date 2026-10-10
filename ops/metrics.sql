-- Dashboard queries of specs/01-architecture.md §Observability ("dashboards, not
-- pages"), one per block, split and run like ops/alerts.sql. A block reads "now"
-- from the setting alerts.now when it is set, else now(), and its window from
-- metrics.window when it is set, else the default its comment names.

-- name: rejects_by_code
-- Rejects per reject_code over the decisions in the window (default 7 days). An
-- override counts as wrong_action (02 G3); an approval without one has no code.
-- Excludes eval cases and canaries (01 Data model: canaries stay out of quality
-- metrics).
with clock as (
  select
    coalesce(nullif(current_setting('alerts.now', true), '')::timestamptz, now()) as now,
    coalesce(nullif(current_setting('metrics.window', true), '')::interval, interval '7 days') as span
),
decided as (
  select case when p.operator_override then 'wrong_action' else p.reject_code end as code
  from proposed_actions p
  join cases c on c.id = p.case_id
  cross join clock
  where p.status in ('approved', 'executed', 'failed', 'rejected')
    and p.decided_at > clock.now - clock.span
    and p.decided_at <= clock.now
    and not p.is_canary
    and c.source <> 'eval'
)
select code, count(*) as rejects
from decided
where code is not null
group by code
order by rejects desc, code;
