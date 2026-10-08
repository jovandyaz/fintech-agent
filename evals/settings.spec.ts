import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { evalHarness } from '@fintech-agent/api/evals';

import { runnerEnv, runnerSettings } from './settings.js';

const ENV_EXAMPLE = readFileSync(
  resolve(import.meta.dirname, '../.env.example'),
  'utf8',
);

describe('runnerSettings (03 §Runner: the same dev defaults as compose)', () => {
  it('judges with an Opus-class model and caps agent spend at 12, so attempts in flight and the judge stay under the approved USD 15', () => {
    expect(runnerSettings({}, ENV_EXAMPLE)).toEqual({
      JUDGE_MODEL: 'claude-opus-5-5',
      EVAL_SPEND_CAP_USD: 12,
    });
  });

  it('lets the environment override the defaults', () => {
    expect(
      runnerSettings({ EVAL_SPEND_CAP_USD: '3' }, ENV_EXAMPLE),
    ).toMatchObject({ EVAL_SPEND_CAP_USD: 3 });
  });

  it.each([
    [{ EVAL_SPEND_CAP_USD: '0' }],
    [{ EVAL_SPEND_CAP_USD: 'lots' }],
    [{ JUDGE_MODEL: ' ' }],
    [{ JUDGE_MODEL: 'claude-opus-4-1' }],
  ])('refuses %j', (env) => {
    expect(() => runnerSettings(env, ENV_EXAMPLE)).toThrow();
  });
});

describe('runnerEnv (the key from the .env compose reads, nothing else)', () => {
  const DOT_ENV = [
    'ANTHROPIC_API_KEY=sk-test',
    'AGENT_MODEL_B=claude-haiku-5-5',
    'RUN_COST_CEILING_USD=0.4',
    'CORE_EXECUTOR_KEY=dev-core-executor-key',
    'MCP_URL=http://mcp:3020/mcp',
    'API_DATABASE_URL=postgres://copilot_api@postgres/copilot',
  ].join('\n');

  it('takes the key, the models and the run ceilings from .env, never the executor key or container urls', () => {
    expect(runnerEnv({}, DOT_ENV)).toEqual({
      ANTHROPIC_API_KEY: 'sk-test',
      AGENT_MODEL_B: 'claude-haiku-5-5',
      RUN_COST_CEILING_USD: '0.4',
    });
  });

  it('lets the process environment win over .env', () => {
    expect(
      runnerEnv({ ANTHROPIC_API_KEY: 'from-shell' }, DOT_ENV)[
        'ANTHROPIC_API_KEY'
      ],
    ).toBe('from-shell');
  });

  it('refuses to run the harness when the shell hands the runner the executor key (02 G1)', () => {
    expect(() =>
      evalHarness({
        env: runnerEnv({ CORE_EXECUTOR_KEY: 'x' }, DOT_ENV),
        envExample: ENV_EXAMPLE,
        log: () => undefined,
      }),
    ).toThrow(/CORE_EXECUTOR_KEY/);
  });

  it('keeps the process environment as it is without a .env', () => {
    expect(runnerEnv({ JUDGE_MODEL: 'x' }, null)).toEqual({ JUDGE_MODEL: 'x' });
  });
});
