import { describe, expect, it } from 'vitest';

import { computeAgreement, formatAgreement } from './agreement.js';
import type { HumanLabel, JudgeVerdict } from './rows.js';

const verdict = (row_id: string, judge_pass: boolean): JudgeVerdict => ({
  row_id,
  judge_pass,
  judge_reason: '',
});
const label = (row_id: string, human_pass: boolean): HumanLabel => ({
  row_id,
  human_pass,
  reason: human_pass ? 'grounded' : 'invented amount',
});

const rowsOf = (
  cells: [judgePass: boolean, humanPass: boolean, count: number][],
) => {
  const verdicts: JudgeVerdict[] = [];
  const labels: HumanLabel[] = [];
  let id = 0;
  for (const [judgePass, humanPass, count] of cells) {
    for (let i = 0; i < count; i += 1) {
      id += 1;
      verdicts.push(verdict(`r${id}`, judgePass));
      labels.push(label(`r${id}`, humanPass));
    }
  }
  return { verdicts, labels };
};

describe('judge agreement (03 §Judge validation, steps 3–4)', () => {
  it('counts the fail class as positive: TPR is judge-fails over human-fails', () => {
    const { verdicts, labels } = rowsOf([
      [true, true, 40],
      [false, false, 5],
      [true, false, 1],
    ]);
    const report = computeAgreement(verdicts, labels);
    expect(report.cells).toEqual({
      bothPass: 40,
      bothFail: 5,
      judgePassHumanFail: 1,
      judgeFailHumanPass: 0,
    });
    expect(report.tpr.rate).toBeCloseTo(5 / 6, 6);
    expect(report.tnr.rate).toBe(1);
    expect(report.kappa).toBeCloseTo(0.9, 2);
  });

  it('keeps the judge out of the decision below TPR 0.8 though kappa looks high (03 example)', () => {
    const { verdicts, labels } = rowsOf([
      [true, true, 40],
      [false, false, 4],
      [true, false, 2],
    ]);
    const report = computeAgreement(verdicts, labels);
    expect(report.tpr.rate).toBeCloseTo(4 / 6, 6);
    expect(report.thresholdMet).toBe(false);
  });

  it('meets the agreement threshold only at TPR ≥ 0.8 and TNR ≥ 0.9', () => {
    const good = rowsOf([
      [true, true, 45],
      [false, true, 5],
      [false, false, 8],
      [true, false, 2],
    ]);
    expect(computeAgreement(good.verdicts, good.labels).thresholdMet).toBe(
      true,
    );
    const lowTnr = rowsOf([
      [true, true, 40],
      [false, true, 10],
      [false, false, 10],
    ]);
    expect(computeAgreement(lowTnr.verdicts, lowTnr.labels).thresholdMet).toBe(
      false,
    );
  });

  it('reports each rate with its Wilson interval', () => {
    const { verdicts, labels } = rowsOf([
      [true, true, 21],
      [false, true, 3],
    ]);
    const { tnr } = computeAgreement(verdicts, labels);
    expect(tnr).toMatchObject({ successes: 21, n: 24 });
    expect(tnr.low).toBeCloseTo(0.69, 2);
    expect(tnr.high).toBeCloseTo(0.96, 2);
  });

  it('counts rows the user has not labeled, and lists every disagreement', () => {
    const report = computeAgreement(
      [verdict('a', true), verdict('b', false), verdict('c', true)],
      [label('a', true), label('b', true)],
    );
    expect(report.unlabeled).toBe(1);
    expect(report.disagreements).toEqual([
      { row_id: 'b', judge_pass: false, human_pass: true, reason: 'grounded' },
    ]);
  });

  it('never meets the threshold while a row is unlabeled', () => {
    const { verdicts, labels } = rowsOf([
      [true, true, 45],
      [false, false, 8],
    ]);
    const report = computeAgreement(verdicts, labels.slice(1));
    expect(report.unlabeled).toBe(1);
    expect(report.thresholdMet).toBe(false);
  });

  it('reports a label for no graded row and a row labeled twice', () => {
    const report = computeAgreement(
      [verdict('a', true)],
      [label('a', true), label('a', false), label('zz', true)],
    );
    expect(report.duplicateLabels).toEqual(['a']);
    expect(report.unmatchedLabels).toEqual(['zz']);
    expect(report.cells.bothPass).toBe(1);
  });

  it('never meets the threshold with no fail rows labeled', () => {
    const { verdicts, labels } = rowsOf([[true, true, 30]]);
    const report = computeAgreement(verdicts, labels);
    expect(report.tpr.rate).toBeNull();
    expect(report.thresholdMet).toBe(false);
  });

  it('prints the rates with intervals, kappa as secondary, and the verdict', () => {
    const { verdicts, labels } = rowsOf([
      [true, true, 45],
      [false, false, 5],
    ]);
    const text = formatAgreement(computeAgreement(verdicts, labels));
    expect(text).toContain('TPR 5/5 = 1.00 [0.57, 1.00]');
    expect(text).toContain('TNR 45/45 = 1.00 [0.92, 1.00]');
    expect(text).toContain('kappa (secondary) 1.00');
    expect(text).toContain('agreement threshold met: yes');
  });
});
