import { describe, expect, it } from 'vitest';

import { CLEAN_DRAFT } from '../judge/controls.js';
import {
  blindRows,
  parseHumanLabels,
  parseJudgeVerdicts,
  parseLabelRows,
  parseRowKeys,
  toJsonl,
  type CalibrationRow,
} from './rows.js';

const runRow = (case_id: string, variant = 'variant-A'): CalibrationRow => ({
  row_id: `${variant}:${case_id}`,
  case_id,
  variant,
  source: 'run',
  judge_input: CLEAN_DRAFT,
});
const negative: CalibrationRow = {
  ...runRow('ADV-01'),
  row_id: 'variant-A:ADV-01:added_promise',
  source: 'mutation',
  mutation: 'added_promise',
};
const sequence = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe('blinded calibration rows (ported judgment-row, 03 blind labeling)', () => {
  const rows = [runRow('ADV-01'), runRow('GEN-01', 'variant-B'), negative];
  const verdicts = rows.map((row) => ({
    row_id: row.row_id,
    judge_pass: row.source === 'run',
    judge_reason: row.row_id,
  }));
  const blinded = blindRows(rows, verdicts, sequence([0.1, 0.9, 0.5]));

  it('gives the labeler only opaque ids and the judge input', () => {
    for (const row of blinded.toLabel) {
      expect(Object.keys(row).sort()).toEqual(['judge_input', 'row_id']);
      expect(row.row_id).toMatch(/^row-\d{3}$/);
    }
    expect(toJsonl(blinded.toLabel)).not.toMatch(
      /variant|mutation|judge_pass|ADV-01|GEN-01/,
    );
  });

  it('keeps case, variant, source and defect in the key file, under the same ids', () => {
    const negativeKey = blinded.keys.find(
      ({ source }) => source === 'mutation',
    );
    expect(negativeKey).toMatchObject({
      case_id: 'ADV-01',
      variant: 'variant-A',
      mutation: 'added_promise',
    });
    expect(blinded.toLabel.map(({ row_id }) => row_id).sort()).toEqual(
      blinded.keys.map(({ row_id }) => row_id).sort(),
    );
  });

  it('carries every verdict to its row under the opaque id', () => {
    for (const verdict of blinded.verdicts) {
      const key = blinded.keys.find(({ row_id }) => row_id === verdict.row_id);
      expect(verdict.judge_reason).toBe(
        rows.find(
          (row) =>
            row.case_id === key?.case_id &&
            row.variant === key.variant &&
            row.source === key.source,
        )?.row_id,
      );
    }
  });

  it('shuffles, so the planted failure is not always last', () => {
    expect(blinded.keys.map(({ source }) => source)).not.toEqual([
      'run',
      'run',
      'mutation',
    ]);
  });

  it('round-trips each file through JSONL', () => {
    expect(parseLabelRows(toJsonl(blinded.toLabel))).toEqual(blinded.toLabel);
    expect(parseRowKeys(toJsonl(blinded.keys))).toEqual(blinded.keys);
    expect(parseJudgeVerdicts(toJsonl(blinded.verdicts))).toEqual(
      blinded.verdicts,
    );
  });

  it('refuses a verdict for a row that does not exist', () => {
    expect(() =>
      blindRows(
        rows,
        [{ row_id: 'nope', judge_pass: true, judge_reason: '' }],
        Math.random,
      ),
    ).toThrow('nope');
  });
});

describe('labels', () => {
  it('reads a label written on one line', () => {
    expect(
      parseHumanLabels(
        '{"row_id":"row-001","human_pass":false,"reason":"invented amount"}\n',
      ),
    ).toEqual([
      { row_id: 'row-001', human_pass: false, reason: 'invented amount' },
    ]);
  });

  it('names the line of a label spread over several lines, as JSONL forbids', () => {
    expect(() => parseHumanLabels('{\n"row_id":"row-001"\n}\n')).toThrow(
      'line 1',
    );
  });

  it('refuses a label without a reason, as 03 asks for one per row', () => {
    expect(() =>
      parseHumanLabels('{"row_id":"a","human_pass":false,"reason":" "}\n'),
    ).toThrow('line 1');
  });

  it('skips blank lines', () => {
    expect(parseHumanLabels('\n\n')).toEqual([]);
  });
});
