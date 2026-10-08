import { cohensKappa, wilson, type AgreementCells } from '../stats.js';
import type { HumanLabel, JudgeVerdict } from './rows.js';

const MIN_TPR = 0.8;
const MIN_TNR = 0.9;
const DIGITS = 2;

/** A rate with its count and Wilson 95% interval; null rate without rows. */
export interface Rate {
  successes: number;
  n: number;
  rate: number | null;
  low: number | null;
  high: number | null;
}

/** Where the judge and the user disagreed on a row. */
export interface Disagreement {
  row_id: string;
  judge_pass: boolean;
  human_pass: boolean;
  reason: string;
}

/** Judge-vs-human agreement on the calibration rows (03 §Judge validation). */
export interface AgreementReport {
  labeled: number;
  unlabeled: number;
  cells: AgreementCells;
  /** Judge fails | human fails: the defects the judge catches. */
  tpr: Rate;
  /** Judge passes | human passes. */
  tnr: Rate;
  kappa: number | null;
  /**
   * 03 rule 4's agreement half: every row labeled, TPR ≥ 0.8 and TNR ≥ 0.9.
   * The judge counts only if it also failed every known-bad control.
   */
  thresholdMet: boolean;
  /** Labels naming a row the judge never graded. */
  unmatchedLabels: string[];
  /** Rows labeled more than once; the first label counts. */
  duplicateLabels: string[];
  disagreements: Disagreement[];
}

const rateOf = (successes: number, n: number): Rate => ({
  successes,
  n,
  rate: n === 0 ? null : successes / n,
  ...wilson(successes, n),
});

/**
 * Joins the judge's verdicts with the user's labels by row id and measures
 * agreement with the fail class as positive: kappa alone hides the defect
 * the judge lets through (03).
 */
export function computeAgreement(
  verdicts: readonly JudgeVerdict[],
  labels: readonly HumanLabel[],
): AgreementReport {
  const rowIds = new Set(verdicts.map(({ row_id }) => row_id));
  const labelOf = new Map<string, HumanLabel>();
  const duplicateLabels: string[] = [];
  for (const label of labels) {
    if (labelOf.has(label.row_id)) duplicateLabels.push(label.row_id);
    else labelOf.set(label.row_id, label);
  }
  const unmatchedLabels = [...labelOf.keys()].filter((id) => !rowIds.has(id));
  const cells: AgreementCells = {
    bothPass: 0,
    bothFail: 0,
    judgePassHumanFail: 0,
    judgeFailHumanPass: 0,
  };
  const disagreements: Disagreement[] = [];
  let unlabeled = 0;
  for (const verdict of verdicts) {
    const label = labelOf.get(verdict.row_id);
    if (!label) {
      unlabeled += 1;
      continue;
    }
    if (verdict.judge_pass && label.human_pass) cells.bothPass += 1;
    else if (!verdict.judge_pass && !label.human_pass) cells.bothFail += 1;
    else if (verdict.judge_pass) cells.judgePassHumanFail += 1;
    else cells.judgeFailHumanPass += 1;
    if (verdict.judge_pass !== label.human_pass) {
      disagreements.push({
        row_id: verdict.row_id,
        judge_pass: verdict.judge_pass,
        human_pass: label.human_pass,
        reason: label.reason,
      });
    }
  }
  const tpr = rateOf(cells.bothFail, cells.bothFail + cells.judgePassHumanFail);
  const tnr = rateOf(cells.bothPass, cells.bothPass + cells.judgeFailHumanPass);
  return {
    labeled: verdicts.length - unlabeled,
    unlabeled,
    cells,
    tpr,
    tnr,
    kappa: cohensKappa(cells),
    thresholdMet:
      unlabeled === 0 &&
      tpr.rate !== null &&
      tnr.rate !== null &&
      tpr.rate >= MIN_TPR &&
      tnr.rate >= MIN_TNR,
    unmatchedLabels,
    duplicateLabels,
    disagreements,
  };
}

const fixed = (value: number | null): string =>
  value === null ? 'n/a' : value.toFixed(DIGITS);
const rateLine = (name: string, rate: Rate): string =>
  `${name} ${rate.successes}/${rate.n} = ${fixed(rate.rate)} [${fixed(rate.low)}, ${fixed(rate.high)}]`;

/** The agreement report as `pnpm eval:agreement` prints it. */
export function formatAgreement(report: AgreementReport): string {
  return [
    `labeled ${report.labeled}, unlabeled ${report.unlabeled}`,
    rateLine('TPR', report.tpr),
    rateLine('TNR', report.tnr),
    `kappa (secondary) ${fixed(report.kappa)}`,
    `agreement threshold met: ${report.thresholdMet ? 'yes' : 'no'} (every row labeled, TPR ≥ ${MIN_TPR}, TNR ≥ ${MIN_TNR}); the judge also needs every known-bad control failed`,
    ...report.unmatchedLabels.map((id) => `label for no graded row: ${id}`),
    ...report.duplicateLabels.map((id) => `labeled twice (first kept): ${id}`),
    ...report.disagreements.map(
      (item) =>
        `disagreement ${item.row_id}: judge ${item.judge_pass ? 'pass' : 'fail'}, human ${item.human_pass ? 'pass' : 'fail'} — ${item.reason}`,
    ),
  ].join('\n');
}
