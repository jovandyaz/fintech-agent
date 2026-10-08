import type { EvalRun } from '@fintech-agent/api/evals';
import { describe, expect, it } from 'vitest';

import { EVAL_CASES } from './cases.js';
import type { RedactorRecall } from './redactor.js';
import {
  gradedAttemptOf,
  judgeSpend,
  markdownSummary,
  summarize,
  type RecordedResult,
} from './summary.js';
import { evalRunOf } from './test/eval-run.js';

const CU01_TEXT =
  '¿Y este cobro de dónde salió? Veo 899 de un PAYPAL que no me suena de nada.';
const JUDGE = 'claude-opus-5-5';
const DROPPED = {
  type: 'none' as const,
  transaction_ids: [],
  reason_code: 'insufficient_information' as const,
};

const recorded = (input: {
  variant?: string;
  repeatIndex?: number;
  run?: Partial<EvalRun>;
  rubric?: {
    pass: boolean;
    graderError?: boolean;
    prompt?: number;
    completion?: number;
  };
  noRun?: boolean;
}): RecordedResult => ({
  vars: { case_id: 'CARD-UNREC-01' },
  provider: { id: 'eval', label: input.variant ?? 'variant-A' },
  response: {
    metadata: input.noRun
      ? {}
      : {
          run: evalRunOf(input.run),
          customer_text: CU01_TEXT,
          repeat_index: input.repeatIndex ?? 0,
        },
  },
  gradingResult: {
    componentResults: [
      { pass: true, reason: 'ok', assertion: { type: 'javascript' } },
      ...(input.rubric
        ? [
            {
              pass: input.rubric.pass,
              reason: 'r',
              assertion: { type: 'llm-rubric' },
              metadata: { graderError: input.rubric.graderError ?? false },
              tokensUsed: {
                prompt: input.rubric.prompt ?? 0,
                completion: input.rubric.completion ?? 0,
              },
            },
          ]
        : []),
    ],
  },
});

const threeOf = (
  variant: string,
  run: Partial<EvalRun> = {},
): RecordedResult[] =>
  [0, 1, 2].map((repeatIndex) =>
    recorded({ variant, repeatIndex, run, rubric: { pass: true } }),
  );

const REDACTOR: RedactorRecall = {
  recall: { successes: 18, n: 20, low: 0.7, high: 0.97 },
  overRedaction: { successes: 3, n: 20, low: 0.05, high: 0.36 },
  degraded: 1,
  costUsd: 0.002,
  outcomes: [
    { id: 'RED-04', covered: false, overRedactedSpans: 0, degraded: true },
    { id: 'RED-09', covered: false, overRedactedSpans: 2, degraded: false },
  ],
};

const summaryOf = (results: RecordedResult[], variants: string[]) =>
  summarize({
    redactor: REDACTOR,
    results,
    cases: EVAL_CASES,
    variants,
    judgeModel: JUDGE,
    judgeCounts: false,
    baseline: null,
    full: true,
    date: '2026-10-08',
    commit: 'abc1234',
  });

describe('gradedAttemptOf', () => {
  it('reads the case, variant, attempt, run, masked text and the judge verdict', () => {
    expect(
      gradedAttemptOf(recorded({ repeatIndex: 2, rubric: { pass: false } })),
    ).toMatchObject({
      caseId: 'CARD-UNREC-01',
      variant: 'variant-A',
      repeatIndex: 2,
      customerText: CU01_TEXT,
      grounded: false,
    });
  });

  it('has no verdict where the judge was not reached or not asked', () => {
    expect(
      gradedAttemptOf(recorded({ rubric: { pass: false, graderError: true } }))
        ?.grounded,
    ).toBeNull();
    expect(gradedAttemptOf(recorded({}))?.grounded).toBeNull();
  });

  it('skips an attempt that recorded no run', () => {
    expect(gradedAttemptOf(recorded({ noRun: true }))).toBeNull();
  });
});

describe('judgeSpend', () => {
  it('adds up the judge tokens of every graded attempt and prices them', () => {
    const spend = judgeSpend(
      [
        recorded({ rubric: { pass: true, prompt: 250_000 } }),
        recorded({
          rubric: { pass: true, prompt: 250_000, completion: 50_000 },
        }),
        recorded({}),
      ],
      JUDGE,
    );
    expect(spend).toEqual({
      promptTokens: 500_000,
      completionTokens: 50_000,
      costUsd: 3,
    });
  });
});

describe('summarize', () => {
  it('reports each variant, decides between two and sets the next baseline', () => {
    const summary = summaryOf(
      [
        ...threeOf('variant-A', { cost_usd: 0.1 }),
        ...threeOf('variant-B', { cost_usd: 0.04 }),
      ],
      ['variant-A', 'variant-B'],
    );
    expect(summary.reports.map(({ attempts }) => attempts)).toEqual([3, 3]);
    expect(summary.decision?.pick).toBe('variant-B');
    expect(summary.gate).toEqual([]);
    expect(summary.baseline).toEqual({
      commit: 'abc1234',
      high_stakes_passed: {
        'variant-A': ['CARD-UNREC-01'],
        'variant-B': ['CARD-UNREC-01'],
      },
    });
    expect(summary.costUsd.agents).toBeCloseTo(0.42);
  });

  it('makes no decision when one variant ran', () => {
    expect(summaryOf(threeOf('variant-B'), ['variant-B']).decision).toBeNull();
  });

  it("takes 03's decision only over a full run", () => {
    const subset = summarize({
      redactor: null,
      results: [
        ...threeOf('variant-A', { cost_usd: 0.1 }),
        ...threeOf('variant-B', { cost_usd: 0.04 }),
      ],
      cases: EVAL_CASES,
      variants: ['variant-A', 'variant-B'],
      judgeModel: JUDGE,
      judgeCounts: false,
      baseline: null,
      full: false,
      date: '2026-10-08',
      commit: 'abc1234',
    });
    expect(subset.decision).toBeNull();
    expect(markdownSummary(subset)).toContain(
      "Decision: not taken; 03's rule reads only a full run",
    );
    expect(markdownSummary(subset)).toContain(
      'Redactor recall not measured (a run with --only).',
    );
  });
});

describe('markdownSummary (03 §EVALS.md shape)', () => {
  const summary = summaryOf(
    [
      ...threeOf('variant-A', { cost_usd: 0.1 }),
      ...threeOf('variant-B', { cost_usd: 0.04 }).slice(0, 2),
      recorded({
        variant: 'variant-B',
        repeatIndex: 2,
        run: { cost_usd: 0.04, proposal: DROPPED },
        rubric: { pass: true },
      }),
    ],
    ['variant-A', 'variant-B'],
  );
  const text = markdownSummary(summary);

  it('heads the block with the date, commit, judge and what the run cost', () => {
    expect(text).toContain(
      'Run of 2026-10-08 at commit `abc1234` · judge `claude-opus-5-5` (informational until calibrated)',
    );
  });

  it('writes one table per variant with counts and Wilson intervals', () => {
    expect(text).toContain('### variant-A · claude-sonnet-5-5 · prompt');
    expect(text).toContain('| pass^3, high-stakes cases | 1/1 (0.21–1.00) |');
    expect(text).toContain('| Groundedness (judge, informational) |');
    expect(text).toContain('| System-level block rate | — |');
  });

  it('lists each failing attempt with the checks it failed', () => {
    expect(text).toContain(
      '| variant-B | CARD-UNREC-01 | 3 | action_type | none | succeeded / completed |',
    );
  });

  it('states the decision with the rule that produced it, and the McNemar pairs', () => {
    expect(text).toContain('Decision: **variant-A** (rule 3: otherwise A).');
    expect(text).toContain('| high-stakes pass^3 | 1 | 0 | 1.000 |');
  });

  it('reports the redactor recall and over-redaction, naming the missed and over-redacted cases, as no gate', () => {
    expect(text).toContain('### Redactor recall (reported, not a gate)');
    expect(text).toContain('| Recall | 18/20 (0.70–0.97) |');
    expect(text).toContain('| Over-redaction | 3/20 (0.05–0.36) |');
    expect(text).toContain('Missed: RED-04 (degraded), RED-09.');
    expect(text).toContain('Over-redacted: RED-09.');
    expect(text).toContain('redactor $0.0020');
  });

  it('states the regression gate outcome, and that no baseline was there to check', () => {
    expect(text).toContain('### Regression gate\n\nPassed.');
    expect(text).toContain(
      'No baseline yet: high-stakes regressions were not checked.',
    );
  });
});
