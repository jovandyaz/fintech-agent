import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EvalRun } from '@fintech-agent/api/evals';
import type { ApiProvider } from 'promptfoo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EVAL_CASES, type EvalCase } from './cases.js';
import { groundednessAssertion } from './judge/groundedness.js';
import { evalProvider } from './provider.js';
import { slimResult } from './results.js';
import {
  formatCaseOutcome,
  summarizeTrials,
  toTrialResult,
  runEvalSuite,
} from './runtime.js';
import { gradedAttemptOf } from './summary.js';
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

  it('reads a scenario id after --only', () => {
    expect(
      parseFlags(['--only', 'SPEI-OUT-03', '--variant', 'A']),
    ).toEqual<RunFlags>({
      variants: ['A'],
      only: 'SPEI-OUT-03',
      repeat: null,
      writeBaseline: false,
    });
  });

  it.each([
    [['--variant', 'C'], '--variant'],
    [['--only', 'SPEI-OUT-99'], 'SPEI-OUT-99'],
    [['--only', 'adv-01'], 'adv-01'],
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

  it('selects exactly the case a scenario id names', () => {
    expect(selectCases(EVAL_CASES, 'GEN-01').map(({ id }) => id)).toEqual([
      'GEN-01',
    ]);
    expect(selectCases(EVAL_CASES, 'ADV-03').map(({ id }) => id)).toEqual([
      'ADV-03',
    ]);
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

  const counting = (prompts: string[]): ApiProvider => ({
    id: () => 'judge-local',
    callApi: (prompt) => {
      prompts.push(prompt);
      return Promise.resolve({
        output: JSON.stringify({ pass: true, score: 1, reason: 'r' }),
      });
    },
  });

  const judgedThrough = (run: EvalRun, label: EvalCase, judge: ApiProvider) =>
    runEvalSuite(
      evalSuite({
        cases: [label],
        providers: [
          evalProvider({ variant: 'A', attempt: () => Promise.resolve(run) }),
        ],
        repeat: 1,
        groundedness: groundednessAssertion('rubric'),
        grader: judge,
      }),
    );

  it("shows the judge the model's draft with its placeholders unfilled, never the filled reply", async () => {
    const prompts: string[] = [];
    const run = evalRunOf();
    await judgedThrough(run, labelOf('CARD-UNREC-01'), counting(prompts));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(run.judge_input?.draft_reply);
    expect(prompts[0]).toContain('{{folio}}');
    expect(prompts[0]).not.toContain(run.folio);
  });

  it('never calls the judge for a run that persisted no reply: it is recorded as not judged, never as a pass', async () => {
    const prompts: string[] = [];
    const fellBack = evalRunOf({
      run_status: 'fallback',
      proposal: {
        type: 'none',
        transaction_ids: [],
        reason_code: 'insufficient_information',
      },
      draft_reply: null,
      judge_input: null,
    });
    const [result] = await judgedThrough(
      fellBack,
      labelOf('GEN-01'),
      counting(prompts),
    );
    expect(prompts).toEqual([]);
    const rubric = result?.gradingResult?.componentResults?.find(
      ({ assertion }) => assertion?.type === 'llm-rubric',
    );
    expect(rubric).toMatchObject({
      pass: false,
      metadata: { graderError: true },
    });
    expect(rubric?.reason).toContain('not judged');
    expect(gradedAttemptOf(slimResult(result!))?.grounded).toBeNull();
    expect(toTrialResult(result!)).toMatchObject({ neverRan: false });
  });

  it('prints a fallback whose code checks pass as a pass: not judged is neutral, never an ungraded FAIL', async () => {
    const fellBack = evalRunOf({
      run_status: 'fallback',
      category: 'general_inquiry',
      proposal: {
        type: 'none',
        transaction_ids: [],
        reason_code: 'insufficient_information',
      },
      draft_reply: null,
      judge_input: null,
    });
    const results = await judgedThrough(
      fellBack,
      labelOf('GEN-01'),
      counting([]),
    );
    expect(results.map(toTrialResult)).toMatchObject([
      { success: true, errored: false, neverRan: false },
    ]);
    const [outcome] = summarizeTrials(results.map(toTrialResult));
    expect(formatCaseOutcome(outcome!)).toMatch(/^PASS 1\/1 /);
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
