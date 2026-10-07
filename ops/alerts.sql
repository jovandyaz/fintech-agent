-- Alert queries of specs/01-architecture.md §Alerts, one per block.
-- Each block starts with "-- name: <query>" and returns one row per firing alert.

-- name: canary_catch_rate
-- Canary catch rate per operator < 100% over that operator's last 20 canaries.
-- Owner: ops lead (coaching, not blame).
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
