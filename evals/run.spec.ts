import type { EvalRun } from '@fintech-agent/api/evals';
import { describe, expect, it } from 'vitest';

import { EVAL_CASES } from './cases.js';
import type { JudgeStanding } from './calibration/standing.js';
import { spendCap } from './budget.js';
import { fixtureOf } from './fixtures.js';
import { cappedAttempts, concludeRun, prepareRun } from './run.js';
import type { CaseOutcome } from './runtime.js';
import type { RunFlags } from './suite.js';
import type { RedactorRecall } from './redactor.js';
import type { RecordedResult } from './summary.js';
import { evalRunOf } from './test/eval-run.js';

const CASES = EVAL_CASES.filter(({ id }) => id === 'CARD-UNREC-01');
const FULL: RunFlags = {
  variants: ['A', 'B'],
  only: null,
  repeat: null,
  writeBaseline: false,
};
const STANDING: JudgeStanding = {
  counts: false,
  why: 'no calibration yet (pnpm eval:judgments)',
  controlsFailed: null,
  agreement: null,
};
const DROPPED = {
  type: 'none' as const,
  transaction_ids: [],
  reason_code: 'insufficient_information' as const,
};

const recorded = (
  variant: string,
  repeatIndex: number,
  run: Partial<EvalRun> = {},
): RecordedResult => ({
  vars: { case_id: 'CARD-UNREC-01' },
  provider: { id: 'eval', label: variant },
  response: {
    metadata: {
      run: evalRunOf(run),
      customer_text: 'Veo 899 de un PAYPAL.',
      repeat_index: repeatIndex,
    },
  },
  gradingResult: { componentResults: [] },
});

const outcome = (
  variant: string,
  over: Partial<CaseOutcome> = {},
): CaseOutcome => ({
  caseId: 'CARD-UNREC-01',
  providerId: variant,
  trials: 3,
  passes: 3,
  graderErrors: 0,
  unrunAttempts: 0,
  passAll: true,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  ...over,
});

const both = (run: Partial<EvalRun> = {}) =>
  ['variant-A', 'variant-B'].flatMap((variant) =>
    [0, 1, 2].map((index) => recorded(variant, index, run)),
  );

const conclude = (input: {
  results: RecordedResult[];
  outcomes?: CaseOutcome[];
  flags?: Partial<RunFlags>;
  redactor?: RedactorRecall | null;
}) =>
  concludeRun({
    results: input.results,
    outcomes: input.outcomes ?? [outcome('variant-A'), outcome('variant-B')],
    cases: CASES,
    flags: { ...FULL, ...input.flags },
    judgeModel: 'claude-opus-5-5',
    rubricSha256: 'f'.repeat(64),
    standing: STANDING,
    baseline: null,
    now: new Date('2026-10-08T15:30:12Z'),
    commit: 'abc1234',
    spend: { agentsUsd: 1.5, capUsd: 13 },
    redactor: input.redactor ?? null,
  });

describe('concludeRun (03 §Runner: never a silent 0%)', () => {
  it('records an incomplete run without a summary, prints no result and fails', () => {
    const conclusion = conclude({
      results: [
        ...both().slice(0, 3),
        {
          vars: { case_id: 'CARD-UNREC-01' },
          provider: { id: 'eval', label: 'variant-B' },
          error: 'stack down',
        },
      ],
      outcomes: [
        outcome('variant-A'),
        outcome('variant-B', { passes: 0, unrunAttempts: 3, passAll: false }),
      ],
    });
    expect(conclusion.record.summary).toBeNull();
    expect(conclusion.record.meta.incomplete).toEqual([
      'variant-B CARD-UNREC-01 (3)',
    ]);
    expect(conclusion.exitCode).toBe(1);
    const printed = conclusion.lines.join('\n');
    expect(printed).toContain('reached no verdict');
    expect(printed).toContain('first errors: stack down');
    expect(printed).not.toContain('Decision:');
    expect(printed).not.toContain('Regression gate');
  });

  it('counts a single never-ran attempt as an incomplete run', () => {
    const conclusion = conclude({
      results: both().slice(0, 5),
      outcomes: [
        outcome('variant-A'),
        outcome('variant-B', { passes: 2, unrunAttempts: 1, passAll: false }),
      ],
    });
    expect(conclusion.record.summary).toBeNull();
    expect(conclusion.exitCode).toBe(1);
  });

  it('reports a complete full run, with the agent spend against the cap', () => {
    const conclusion = conclude({ results: both() });
    expect(conclusion.exitCode).toBe(0);
    expect(conclusion.record.meta).toMatchObject({
      timestamp: '2026-10-08T15:30:12.000Z',
      full: true,
      incomplete: [],
      rubricSha256: 'f'.repeat(64),
    });
    const printed = conclusion.lines.join('\n');
    expect(printed).toContain('### Regression gate');
    expect(printed).toContain('agent spend $1.5000 of the $13 cap');
    expect(printed).toContain('Judge standing: no calibration yet');
  });

  it('records and prints the redactor recall it measured', () => {
    const redactor: RedactorRecall = {
      recall: { successes: 19, n: 20, low: 0.76, high: 0.99 },
      overRedaction: { successes: 0, n: 20, low: 0, high: 0.16 },
      degraded: 0,
      costUsd: 0.001,
      outcomes: [],
    };
    const conclusion = conclude({ results: both(), redactor });
    expect(conclusion.record.summary?.redactor).toEqual(redactor);
    expect(conclusion.lines.join('\n')).toContain('| Recall | 19/20');
  });

  it('fails a run the regression gate fails', () => {
    const conclusion = conclude({
      results: both({ executions: 1 }),
    });
    expect(conclusion.exitCode).toBe(1);
  });

  it('sets the baseline only from a complete full run, holding only the variants that blocked every attack with no execution', () => {
    expect(
      conclude({ results: both(), flags: { writeBaseline: true } }).baseline,
    ).toEqual({
      commit: 'abc1234',
      high_stakes_passed: {
        'variant-A': ['CARD-UNREC-01'],
        'variant-B': ['CARD-UNREC-01'],
      },
    });
    const failing = conclude({
      results: [
        ...both().slice(0, 5),
        recorded('variant-B', 2, { executions: 1, proposal: DROPPED }),
      ],
      flags: { writeBaseline: true },
    });
    expect(failing.baseline).toEqual({
      commit: 'abc1234',
      high_stakes_passed: { 'variant-A': ['CARD-UNREC-01'] },
    });
    expect(failing.exitCode).toBe(1);
    const noneClean = conclude({
      results: both({ executions: 1 }),
      flags: { writeBaseline: true },
    });
    expect(noneClean.baseline).toBeNull();
    expect(noneClean.lines.join('\n')).toContain('baseline not written');
    for (const flags of [
      { only: 'high-stakes' as const },
      { repeat: 3 },
      { variants: ['A' as const] },
    ]) {
      const subset = conclude({
        results: both(),
        flags: { writeBaseline: true, ...flags },
      });
      expect(subset.record.meta.full).toBe(false);
      expect(subset.baseline).toBeNull();
      expect(subset.exitCode).toBe(1);
    }
  });
});

const ENV_EXAMPLE = [
  'JUDGE_MODEL=claude-opus-5-5',
  'EVAL_SPEND_CAP_USD=13',
].join('\n');

describe('prepareRun (before any paid call)', () => {
  it("takes the key from .env and hands it to the judge's provider", () => {
    const target: NodeJS.ProcessEnv = {};
    const prepared = prepareRun({
      processEnv: {},
      dotEnv: 'ANTHROPIC_API_KEY=sk-test',
      envExample: ENV_EXAMPLE,
      target,
    });
    expect(target['ANTHROPIC_API_KEY']).toBe('sk-test');
    expect(prepared.settings).toEqual({
      JUDGE_MODEL: 'claude-opus-5-5',
      EVAL_SPEND_CAP_USD: 13,
    });
  });

  it('hands no key on for a judge it cannot price', () => {
    const target: NodeJS.ProcessEnv = {};
    expect(() =>
      prepareRun({
        processEnv: { JUDGE_MODEL: 'claude-opus-4-1' },
        dotEnv: 'ANTHROPIC_API_KEY=sk-test',
        envExample: ENV_EXAMPLE,
        target,
      }),
    ).toThrow('JUDGE_MODEL');
    expect(target).toEqual({});
  });

  it('refuses a run without a key, or with a judge it cannot price, before spending anything', () => {
    expect(() =>
      prepareRun({
        processEnv: { ANTHROPIC_API_KEY: '' },
        dotEnv: 'ANTHROPIC_API_KEY=sk-test',
        envExample: ENV_EXAMPLE,
        target: {},
      }),
    ).toThrow('ANTHROPIC_API_KEY');
    expect(() =>
      prepareRun({
        processEnv: { JUDGE_MODEL: 'claude-opus-4-1' },
        dotEnv: 'ANTHROPIC_API_KEY=sk-test',
        envExample: ENV_EXAMPLE,
        target: {},
      }),
    ).toThrow('JUDGE_MODEL');
  });
});

describe('cappedAttempts', () => {
  it('puts every variant behind one spend cap', async () => {
    const calls: string[] = [];
    const attempts = cappedAttempts(
      ['A', 'B'],
      (variant) => {
        calls.push(variant);
        return Promise.resolve(evalRunOf({ cost_usd: 0.06 }));
      },
      spendCap(0.1),
    );
    const fixture = fixtureOf('GEN-01');
    await attempts.get('A')?.(fixture);
    await attempts.get('B')?.(fixture);
    await expect(attempts.get('A')?.(fixture)).rejects.toThrow('spend cap');
    expect(calls).toEqual(['A', 'B']);
  });
});
