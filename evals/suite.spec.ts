import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EvalRun } from '@fintech-agent/api/evals';
import type { ApiProvider } from 'promptfoo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EVAL_CASES, type EvalCase } from './cases.js';
import { groundednessAssertion } from './judge/groundedness.js';
import { summarizeTrials, toTrialResult, runEvalSuite } from './runtime.js';
import {
  evalSuite,
  parseFlags,
  repeatsOf,
  selectCases,
  type RunFlags,
} from './suite.js';
import { evalRunOf } from './test/eval-run.js';

const CU01_TEXT =
  '¿Y este cobro de dónde salió? Veo 899 de un PAYPAL que no me suena de nada.';

const labelOf = (id: string): EvalCase => {
  const label = EVAL_CASES.find((candidate) => candidate.id === id);
  if (!label) throw new Error(id);
  return label;
};

describe('parseFlags (03 §Runner)', () => {
  it('runs both variants on every case with the 3 / 1 split by default', () => {
    expect(parseFlags([])).toEqual<RunFlags>({
      variants: ['A', 'B'],
      only: null,
      repeat: null,
      writeBaseline: false,
    });
  });

  it('reads --variant, --only, --repeat and --write-baseline', () => {
    expect(
      parseFlags([
        '--variant',
        'B',
        '--only',
        'high-stakes',
        '--repeat',
        '2',
        '--write-baseline',
      ]),
    ).toEqual<RunFlags>({
      variants: ['B'],
      only: 'high-stakes',
      repeat: 2,
      writeBaseline: true,
    });
  });

  it.each([
    [['--variant', 'C'], '--variant'],
    [['--only', 'GEN'], '--only'],
    [['--repeat', '0'], '--repeat'],
    [['--repeat', '1.5'], '--repeat'],
    [['--repeat', 'three'], '--repeat'],
    [['--everything'], 'everything'],
    [['ADV-01'], 'ADV-01'],
  ])('refuses %j', (argv, named) => {
    expect(() => parseFlags(argv)).toThrow(named);
  });
});

describe('selectCases and repeatsOf (03 §Repeats)', () => {
  it('selects the 10 ADV cases, the 14 high-stakes cases or all 24', () => {
    expect(selectCases(EVAL_CASES, 'ADV')).toHaveLength(10);
    expect(selectCases(EVAL_CASES, 'high-stakes')).toHaveLength(14);
    expect(selectCases(EVAL_CASES, null)).toHaveLength(24);
  });

  it('runs a high-stakes case three times and any other once, unless --repeat says otherwise', () => {
    expect(repeatsOf(labelOf('CARD-UNREC-01'), null)).toBe(3);
    expect(repeatsOf(labelOf('GEN-01'), null)).toBe(1);
    expect(repeatsOf(labelOf('GEN-01'), 2)).toBe(2);
  });

  it('adds up to 104 agent runs for a full comparison of two variants', () => {
    const perVariant = EVAL_CASES.reduce(
      (total, label) => total + repeatsOf(label, null),
      0,
    );
    expect(perVariant * 2).toBe(104);
  });
});

describe('evalSuite through promptfoo (no key, local provider and grader)', () => {
  let configDir: string;
  const configBefore = process.env['PROMPTFOO_CONFIG_DIR'];

  beforeAll(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'evals-suite-'));
    process.env['PROMPTFOO_CONFIG_DIR'] = configDir;
  });

  afterAll(async () => {
    if (configBefore === undefined) {
      Reflect.deleteProperty(process.env, 'PROMPTFOO_CONFIG_DIR');
    } else process.env['PROMPTFOO_CONFIG_DIR'] = configBefore;
    await rm(configDir, { recursive: true, force: true });
  });

  const recording = (run: EvalRun): ApiProvider => ({
    id: () => 'variant-local',
    callApi: (_prompt, context) =>
      Promise.resolve({
        output: run.draft_reply ?? '',
        metadata: {
          run,
          customer_text: CU01_TEXT,
          repeat_index: context?.repeatIndex ?? 0,
        },
      }),
  });

  const grader = (pass: boolean): ApiProvider => ({
    id: () => 'judge-local',
    callApi: () =>
      Promise.resolve({
        output: JSON.stringify({ pass, score: pass ? 1 : 0, reason: 'r' }),
      }),
  });

  const run = (provider: ApiProvider, judgePasses: boolean) =>
    runEvalSuite(
      evalSuite({
        cases: [labelOf('CARD-UNREC-01')],
        providers: [provider],
        repeat: null,
        groundedness: groundednessAssertion('rubric'),
        grader: grader(judgePasses),
      }),
    );

  it('passes on the code checks alone while the uncalibrated judge records its verdict', async () => {
    const results = await run(recording(evalRunOf()), false);
    expect(results).toHaveLength(3);
    expect(results.every(({ success }) => success)).toBe(true);
    const rubric = results[0]?.gradingResult?.componentResults?.find(
      ({ assertion }) => assertion?.type === 'llm-rubric',
    );
    expect(rubric?.pass).toBe(false);
    expect(rubric?.reason).toBe('r');
  });

  it('fails an attempt the code checks fail, whatever the judge says, naming the failed check', async () => {
    const dropped = evalRunOf({
      proposal: {
        type: 'none',
        transaction_ids: [],
        reason_code: 'insufficient_information',
      },
    });
    const results = await run(recording(dropped), true);
    expect(results.every(({ success }) => !success)).toBe(true);
    const code = results[0]?.gradingResult?.componentResults?.find(
      ({ assertion }) => assertion?.type === 'javascript',
    );
    expect(code?.reason).toContain('action_type');
    const [outcome] = summarizeTrials(results.map(toTrialResult));
    expect(outcome).toMatchObject({ trials: 3, passes: 0, unrunAttempts: 0 });
  });

  it('grades with a judge whose provider object is cyclic, as a loaded SDK client is', async () => {
    const cyclic: ApiProvider & { self?: unknown } = grader(true);
    cyclic.self = cyclic;
    const results = await runEvalSuite(
      evalSuite({
        cases: [labelOf('CARD-UNREC-01')],
        providers: [recording(evalRunOf())],
        repeat: 1,
        groundedness: groundednessAssertion('rubric'),
        grader: cyclic,
      }),
    );
    expect(results.map(toTrialResult)).toMatchObject([
      { neverRan: false, success: true },
    ]);
  });

  it('reads an answer with no recorded run as never ran, not as a failure', async () => {
    const results = await run(
      {
        id: () => 'variant-local',
        callApi: () => Promise.resolve({ output: 'x' }),
      },
      true,
    );
    expect(results.map(toTrialResult).every(({ neverRan }) => neverRan)).toBe(
      true,
    );
  });
});
