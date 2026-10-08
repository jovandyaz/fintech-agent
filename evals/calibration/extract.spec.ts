import { describe, expect, it } from 'vitest';

import { CLEAN_DRAFT } from '../judge/controls.js';
import { extractJudgments } from './extract.js';

const RUBRIC = 'llm-rubric';

interface Component {
  pass: boolean;
  score: number;
  reason: string;
  assertion: { type: string };
  metadata?: { graderError?: boolean };
}

const result = (
  case_id: string,
  provider: string,
  repeat_index: number,
  judge: { pass: boolean; reason: string } | null,
) => ({
  vars: { case_id },
  provider: { id: provider },
  response: {
    output: 'draft',
    metadata: { repeat_index, judge_input: CLEAN_DRAFT },
  },
  gradingResult: {
    pass: true,
    score: 1,
    reason: '',
    componentResults: <Component[]>[
      {
        pass: true,
        score: 1,
        reason: 'code',
        assertion: { type: 'javascript' },
      },
      ...(judge
        ? [{ ...judge, score: judge.pass ? 1 : 0, assertion: { type: RUBRIC } }]
        : []),
    ],
  },
});

describe('extractJudgments (ported judgment-extract)', () => {
  it('takes the first attempt of each case and variant, with its judge verdict apart from the row', () => {
    const { rows, verdicts } = extractJudgments([
      result('ADV-01', 'variant-A', 1, { pass: false, reason: 'second' }),
      result('ADV-01', 'variant-A', 0, { pass: true, reason: 'first' }),
      result('ADV-01', 'variant-B', 0, { pass: false, reason: 'b' }),
      result('GEN-01', 'variant-A', 0, { pass: true, reason: 'gen' }),
    ]);
    expect(rows.map(({ row_id }) => row_id)).toEqual([
      'variant-A:ADV-01',
      'variant-B:ADV-01',
      'variant-A:GEN-01',
    ]);
    expect(rows[0]).toEqual({
      row_id: 'variant-A:ADV-01',
      case_id: 'ADV-01',
      variant: 'variant-A',
      source: 'run',
      judge_input: CLEAN_DRAFT,
    });
    expect(verdicts[0]).toEqual({
      row_id: 'variant-A:ADV-01',
      judge_pass: true,
      judge_reason: 'first',
    });
  });

  it('leaves out and counts a rubric the grader never reached, which is no verdict', () => {
    const unreached = result('ADV-01', 'variant-A', 0, {
      pass: false,
      reason: '529 overloaded',
    });
    unreached.gradingResult.componentResults[1] = {
      ...unreached.gradingResult.componentResults[1]!,
      metadata: { graderError: true },
    };
    const { rows, ungraded } = extractJudgments([unreached]);
    expect(rows).toEqual([]);
    expect(ungraded).toBe(1);
  });

  it('refuses a result whose provider recorded no judge input', () => {
    const missing = result('ADV-01', 'variant-A', 0, {
      pass: true,
      reason: '',
    });
    missing.response.metadata = { repeat_index: 0 } as never;
    expect(() => extractJudgments([missing])).toThrow('variant-A:ADV-01');
  });

  it('skips a result the judge never graded (no draft, or the provider failed)', () => {
    const { rows, verdicts } = extractJudgments([
      result('GEN-01', 'variant-A', 0, null),
    ]);
    expect(rows).toEqual([]);
    expect(verdicts).toEqual([]);
  });
});
