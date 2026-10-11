-- Each attempt's steps for the canary calibration (apps/api/src/canaries/real-runs.spec.ts),
-- read from the stack that ran the eval:
-- psql -At -v run_ids="$(jq -c '[.results[].response.metadata.run.run_id]' <results>)" -f evals/export-steps.sql
select json_agg(run order by run ->> 'run_id')
from (
  select json_build_object(
    'run_id', run_id,
    'steps', json_agg(json_build_object(
      'kind', kind,
      'input_tokens', input_tokens,
      'output_tokens', output_tokens,
      'cost_usd', cost_usd,
      'output', case when kind in ('tool', 'retrieval') then output_masked end,
      'codes', case when kind = 'validation' then output_masked -> 'codes' end
    ) order by idx)
  ) as run
  from run_steps
  where run_id in (select json_array_elements_text(:'run_ids'::json))
  group by run_id
) runs;
