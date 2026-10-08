import { parseEnv } from 'node:util';

import { z } from 'zod';

import { PRICED_JUDGES } from './judge/groundedness.js';

const RunnerSettingsSchema = z.object({
  JUDGE_MODEL: z.enum(PRICED_JUDGES),
  EVAL_SPEND_CAP_USD: z.coerce.number().positive(),
});

/** The runner's own settings (03 §Runner, §Judge validation). */
export type RunnerSettings = z.infer<typeof RunnerSettingsSchema>;

// .env is written for compose: its urls name containers the host cannot
// reach and it may hold the executor key, so the runner takes from it only
// what makes its runs the stack's own.
const FROM_DOT_ENV = [
  'ANTHROPIC_API_KEY',
  'AGENT_MODEL_A',
  'AGENT_MODEL_B',
  'REDACTOR_MODEL',
  'RUN_TIMEOUT_MS',
  'RUN_COST_CEILING_USD',
  'RUN_INPUT_TOKEN_CEILING',
  'JUDGE_MODEL',
  'EVAL_SPEND_CAP_USD',
] as const;

/** The runner's environment: the process environment over the allowed keys of `.env` (null when there is none). */
export function runnerEnv(
  env: NodeJS.ProcessEnv,
  dotEnv: string | null,
): NodeJS.ProcessEnv {
  const fromFile = dotEnv === null ? {} : parseEnv(dotEnv);
  const allowed = Object.fromEntries(
    FROM_DOT_ENV.flatMap((name) =>
      fromFile[name] === undefined ? [] : [[name, fromFile[name]]],
    ),
  );
  return { ...allowed, ...env };
}

/** The runner's settings from the environment over the dev defaults in `.env.example`, as compose reads them. */
export function runnerSettings(
  env: NodeJS.ProcessEnv,
  envExample: string,
): RunnerSettings {
  return RunnerSettingsSchema.parse({ ...parseEnv(envExample), ...env });
}
