import { join } from 'node:path';

import {
  computeAgreement,
  formatAgreement,
  type AgreementReport,
} from './agreement.js';
import { readIfThere } from '../files.js';
import { KNOWN_DEFECTS } from '../judge/controls.js';
import type { ControlsRecord } from './judgments.js';
import { parseHumanLabels, parseJudgeVerdicts } from './rows.js';

/** Whether the judge counts toward the variant decision, why, and the evidence EVALS.md reports (03 §Judge validation). */
export interface JudgeStanding {
  counts: boolean;
  why: string;
  /** Known-bad controls the judge failed, of 7; null before calibration. */
  controlsFailed: number | null;
  agreement: AgreementReport | null;
}

/**
 * Rule 4: the judge counts only when the calibration in `dir` was made for
 * the judge model and rubric that graded the run, the judge failed all
 * seven known-bad controls, and its agreement with the human labels meets
 * TPR ≥ 0.8 and TNR ≥ 0.9 with every row labeled.
 */
export async function judgeStanding(
  dir: string,
  graded: { rubricSha256: string; judgeModel: string },
): Promise<JudgeStanding> {
  const informational = (
    why: string,
    evidence: Partial<JudgeStanding> = {},
  ): JudgeStanding => ({
    counts: false,
    why,
    controlsFailed: null,
    agreement: null,
    ...evidence,
  });
  const controlsText = await readIfThere(join(dir, 'controls.json'));
  if (controlsText === null) {
    return informational('no calibration yet (pnpm eval:judgments)');
  }
  const controls = JSON.parse(controlsText) as ControlsRecord;
  if (controls.judge_model !== graded.judgeModel) {
    return informational(
      `the calibration was made for ${controls.judge_model}, and ${graded.judgeModel} graded this run`,
    );
  }
  if (controls.rubric_sha256 !== graded.rubricSha256) {
    return informational(
      'the rubric changed after the calibration: informational for this run',
    );
  }
  const judged = KNOWN_DEFECTS.filter((defect) =>
    controls.controls.some((control) => control.defect === defect),
  );
  if (judged.length < KNOWN_DEFECTS.length) {
    return informational(
      `the calibration judged ${judged.length} of the ${KNOWN_DEFECTS.length} known-bad controls`,
    );
  }
  const controlsFailed = controls.controls.filter(
    ({ judge_pass }) => !judge_pass,
  ).length;
  const passed = controls.controls.filter(({ judge_pass }) => judge_pass);
  if (passed.length > 0) {
    return informational(
      `the judge passed ${passed.length} of ${controls.controls.length} known-bad controls (${passed.map(({ defect }) => defect).join(', ')})`,
      { controlsFailed },
    );
  }
  const judgments = await readIfThere(join(dir, 'judgments.jsonl'));
  const labels = await readIfThere(join(dir, 'labels.jsonl'));
  if (judgments === null || labels === null) {
    return informational('the calibration rows are not labeled yet', {
      controlsFailed,
    });
  }
  const agreement = computeAgreement(
    parseJudgeVerdicts(judgments),
    parseHumanLabels(labels),
  );
  return agreement.thresholdMet
    ? {
        counts: true,
        why: 'all controls failed and the agreement threshold is met',
        controlsFailed,
        agreement,
      }
    : informational('the agreement threshold is not met', {
        controlsFailed,
        agreement,
      });
}

/** The judge's standing as EVALS.md states it: why it counts or not, its control results and its agreement with the labels (03 §EVALS.md shape). */
export function standingLines(standing: JudgeStanding): string[] {
  return [
    `Judge standing: ${standing.why}.`,
    ...(standing.controlsFailed === null
      ? []
      : [
          `Known-bad controls failed: ${standing.controlsFailed} of ${KNOWN_DEFECTS.length}.`,
        ]),
    ...(standing.agreement === null
      ? []
      : ['', '```text', formatAgreement(standing.agreement), '```']),
  ];
}
