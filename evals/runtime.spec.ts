import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ApiProvider } from 'promptfoo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  caseKeyOf,
  formatCaseOutcome,
  keyForTheJudge,
  requireApiKey,
  runEvalSuite,
  summarizeTrials,
  toTrialResult,
  type TrialResult,
} from './runtime.js';

const PASSED = { pass: true, score: 1, reason: 'ok' };
const failedComponent = (graderError = false) => ({
  pass: false,
  score: 0,
  reason: 'no',
  ...(graderError ? { metadata: { graderError: true as const } } : {}),
});

const trial = (over: Partial<TrialResult> = {}): TrialResult => ({
  caseId: 'CARD-UNREC-01',
  providerId: 'variant-A',
  success: true,
  errored: false,
  neverRan: false,
  inputTokens: 100,
  outputTokens: 20,
  costUsd: 0.01,
  ...over,
});

describe('caseKeyOf (ported, keyed by case and provider)', () => {
  it('keeps the variants of one case apart', () => {
    expect(caseKeyOf('ADV-01', 'variant-A')).not.toBe(
      caseKeyOf('ADV-01', 'variant-B'),
    );
  });

  it('keeps two cases of one variant apart', () => {
    expect(caseKeyOf('ADV-01', 'variant-A')).not.toBe(
      caseKeyOf('ADV-02', 'variant-A'),
    );
  });
});

describe('toTrialResult (ported)', () => {
  it('reads the case, the provider, the tokens and the cost of a trial', () => {
    expect(
      toTrialResult({
        success: true,
        vars: { case_id: 'SPEI-OUT-02' },
        provider: { id: 'variant-B' },
        tokenUsage: { prompt: 900, completion: 120 },
        cost: 0.004,
        gradingResult: { ...PASSED, componentResults: [PASSED] },
      }),
    ).toEqual({
      caseId: 'SPEI-OUT-02',
      providerId: 'variant-B',
      success: true,
      errored: false,
      neverRan: false,
      inputTokens: 900,
      outputTokens: 120,
      costUsd: 0.004,
    });
  });

  it('tells variants apart by label when they share one provider id', () => {
    const shared = 'file://evals/provider.ts';
    const read = (label: string) =>
      toTrialResult({
        success: true,
        vars: { case_id: 'ADV-01' },
        provider: { id: shared, label },
      }).providerId;
    expect(read('variant-A')).toBe('variant-A');
    expect(read('variant-B')).toBe('variant-B');
  });

  it('refuses a result with no provider id or label, which would merge variants', () => {
    expect(() =>
      toTrialResult({
        success: true,
        vars: { case_id: 'ADV-01' },
        provider: {},
      }),
    ).toThrow('provider');
  });

  it('marks a trial errored only when every failing assertion is a grader transport error', () => {
    const onlyGrader = toTrialResult({
      success: false,
      vars: { case_id: 'GEN-01' },
      provider: { id: 'variant-A' },
      gradingResult: {
        pass: false,
        score: 0,
        reason: '529',
        componentResults: [PASSED, failedComponent(true)],
      },
    });
    expect(onlyGrader.errored).toBe(true);
  });

  it('keeps a real failure beside a grader error as a behavioral failure', () => {
    const mixed = toTrialResult({
      success: false,
      vars: { case_id: 'GEN-01' },
      provider: { id: 'variant-A' },
      gradingResult: {
        pass: false,
        score: 0,
        reason: 'no',
        componentResults: [failedComponent(false), failedComponent(true)],
      },
    });
    expect(mixed.errored).toBe(false);
  });

  it('does not count a provider throw as a grader error', () => {
    expect(
      toTrialResult({
        success: false,
        vars: { case_id: 'GEN-01' },
        provider: { id: 'variant-A' },
      }).errored,
    ).toBe(false);
  });

  it('counts a trial without usage as zero tokens and unknown cost', () => {
    expect(
      toTrialResult({
        success: true,
        vars: { case_id: 'GEN-01' },
        provider: { id: 'variant-A' },
      }),
    ).toMatchObject({ inputTokens: 0, outputTokens: 0, costUsd: null });
  });
});

describe('summarizeTrials (ported, pass^k)', () => {
  it('groups repeats by case and variant and counts passes', () => {
    const [outcome] = summarizeTrials([
      trial(),
      trial({ success: false }),
      trial(),
    ]);
    expect(outcome).toMatchObject({
      caseId: 'CARD-UNREC-01',
      providerId: 'variant-A',
      trials: 3,
      passes: 2,
      passAll: false,
    });
  });

  it('passes pass^k only when every attempt passed', () => {
    const [outcome] = summarizeTrials([trial(), trial(), trial()]);
    expect(outcome?.passAll).toBe(true);
  });

  it('never passes pass^k on a case whose trials all lost their grader', () => {
    const [outcome] = summarizeTrials([
      trial({ success: false, errored: true }),
    ]);
    expect(outcome).toMatchObject({ graderErrors: 1, passAll: false });
  });

  it('fails pass^k when any attempt went ungraded: all three must pass (03)', () => {
    const [outcome] = summarizeTrials([
      trial(),
      trial({ success: false, errored: true }),
      trial(),
    ]);
    expect(outcome).toMatchObject({ graderErrors: 1, passAll: false });
  });

  it('counts the attempts that never ran apart from graded failures', () => {
    const [outcome] = summarizeTrials([
      trial(),
      trial({ success: false, neverRan: true }),
    ]);
    expect(outcome).toMatchObject({ unrunAttempts: 1, passAll: false });
  });

  it('keeps the variants of one case apart', () => {
    expect(
      summarizeTrials([trial(), trial({ providerId: 'variant-B' })]),
    ).toHaveLength(2);
  });

  it('sums tokens and cost, and reports an unknown cost when any trial lacked one', () => {
    const [known] = summarizeTrials([trial(), trial()]);
    expect(known).toMatchObject({
      inputTokens: 200,
      outputTokens: 40,
      costUsd: 0.02,
    });
    const [unknown] = summarizeTrials([trial(), trial({ costUsd: null })]);
    expect(unknown?.costUsd).toBeNull();
  });
});

describe('formatCaseOutcome (ported)', () => {
  it('shows passes over trials, tokens and cost', () => {
    const [outcome] = summarizeTrials([trial(), trial({ success: false })]);
    expect(formatCaseOutcome(outcome!)).toBe(
      'FAIL 1/2 · 200/40 tok · $0.0200 · variant-A · CARD-UNREC-01',
    );
  });

  it('names the ungraded trials', () => {
    const [outcome] = summarizeTrials([
      trial(),
      trial({ success: false, errored: true }),
    ]);
    expect(formatCaseOutcome(outcome!)).toBe(
      'FAIL 1/1 graded, 1 of 2 ungraded · 200/40 tok · $0.0200 · variant-A · CARD-UNREC-01',
    );
  });
});

describe('keyForTheJudge', () => {
  it("hands the runner's key to promptfoo's Anthropic provider, which reads only the process environment", () => {
    const target: NodeJS.ProcessEnv = {};
    keyForTheJudge({ ANTHROPIC_API_KEY: 'k' }, target);
    expect(target['ANTHROPIC_API_KEY']).toBe('k');
  });

  it('refuses a missing key and hands nothing on', () => {
    const target: NodeJS.ProcessEnv = {};
    expect(() => keyForTheJudge({}, target)).toThrow('ANTHROPIC_API_KEY');
    expect(target).toEqual({});
  });
});

describe('requireApiKey', () => {
  it('returns the key when it is set', () => {
    expect(requireApiKey({ ANTHROPIC_API_KEY: 'k' })).toBe('k');
  });

  it('refuses a missing or blank key, so a run never reports 0% for a missing key', () => {
    expect(() => requireApiKey({})).toThrow('ANTHROPIC_API_KEY');
    expect(() => requireApiKey({ ANTHROPIC_API_KEY: '  ' })).toThrow(
      'ANTHROPIC_API_KEY',
    );
  });
});

describe('runEvalSuite with promptfoo (no key, a local provider)', () => {
  let configDir: string;

  const envBefore = {
    PROMPTFOO_CONFIG_DIR: process.env['PROMPTFOO_CONFIG_DIR'],
    PROMPTFOO_DISABLE_TELEMETRY: process.env['PROMPTFOO_DISABLE_TELEMETRY'],
  };

  beforeAll(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'evals-promptfoo-'));
    process.env['PROMPTFOO_CONFIG_DIR'] = configDir;
  });

  afterAll(async () => {
    for (const [name, value] of Object.entries(envBefore)) {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
    await rm(configDir, { recursive: true, force: true });
  });

  it('marks an attempt whose provider threw as never ran', async () => {
    const results = await runEvalSuite({
      providers: [
        {
          id: () => 'variant-down',
          callApi: () => Promise.reject(new Error('stack down')),
        },
      ],
      prompts: ['{{case_id}}'],
      tests: [
        {
          vars: { case_id: 'GEN-01' },
          assert: [{ type: 'equals', value: 'pass' }],
        },
      ],
    });
    expect(results.map(toTrialResult)).toMatchObject([
      { caseId: 'GEN-01', neverRan: true, success: false },
    ]);
  });

  it('marks an attempt whose checker threw as never ran, not as a verdict', async () => {
    const results = await runEvalSuite({
      providers: [
        {
          id: () => 'variant-up',
          callApi: () => Promise.resolve({ output: 'x' }),
        },
      ],
      prompts: ['{{case_id}}'],
      tests: [
        {
          vars: { case_id: 'GEN-01' },
          assert: [
            {
              type: 'javascript',
              value: () => {
                throw new Error('checker bug');
              },
            },
          ],
        },
      ],
    });
    expect(results.map(toTrialResult)).toMatchObject([
      { caseId: 'GEN-01', neverRan: true, success: false },
    ]);
  });

  it('repeats a test as its options ask, with the cache off for every call', async () => {
    const { default: promptfoo } = await import('promptfoo');
    let calls = 0;
    const cacheSeen = new Set<boolean>();
    const provider: ApiProvider = {
      id: () => 'variant-local',
      callApi: (_prompt, context) => {
        calls += 1;
        cacheSeen.add(promptfoo.cache.isCacheEnabled());
        return Promise.resolve({
          output: context?.repeatIndex === 2 ? 'fail' : 'pass',
        });
      },
    };
    const run = () =>
      runEvalSuite({
        providers: [provider],
        prompts: ['{{case_id}}'],
        tests: [
          {
            vars: { case_id: 'ADV-01' },
            options: { repeat: 3 },
            assert: [{ type: 'equals', value: 'pass' }],
          },
          {
            vars: { case_id: 'GEN-01' },
            assert: [{ type: 'equals', value: 'pass' }],
          },
        ],
      });
    const first = await run();
    const second = await run();
    expect(calls).toBe(8);
    expect(
      summarizeTrials(first.map(toTrialResult)).map((outcome) => [
        outcome.caseId,
        outcome.trials,
        outcome.passAll,
      ]),
    ).toEqual([
      ['ADV-01', 3, false],
      ['GEN-01', 1, true],
    ]);
    expect(second).toHaveLength(first.length);
    expect([...cacheSeen]).toEqual([false]);
    expect(process.env['PROMPTFOO_DISABLE_TELEMETRY']).toBe('true');
  });
});
