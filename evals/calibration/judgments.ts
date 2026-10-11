import { createHash } from 'node:crypto';
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { JudgeInput } from '@fintech-agent/api/evals';
import { maskPii } from '@fintech-agent/contracts';
import type { Assertion, GradingResult } from 'promptfoo';

import {
  groundednessAssertion,
  judgeCostUsd,
  type Grader,
} from '../judge/groundedness.js';
import { JUDGE_CONTROLS, type KnownDefect } from '../judge/controls.js';
import { judgeEach } from '../judge/judge-each.js';
import { extractJudgments, type GradedResult } from './extract.js';
import { mutationNegatives } from './mutations.js';
import {
  blindRows,
  toJsonl,
  type CalibrationRow,
  type JudgeVerdict,
} from './rows.js';

/** 03 step 3: about 14 mutation negatives beside the 48 run rows. */
const MUTATION_TARGET = 14;
const JSON_INDENT = 2;
const FILES = {
  toLabel: 'to-label.jsonl',
  key: 'key.jsonl',
  judgments: 'judgments.jsonl',
  controls: 'controls.json',
  labels: 'labels.jsonl',
} as const;

/** The judge's verdict on each known-bad control, with the rubric it judged under. */
export interface ControlsRecord {
  judge_model: string;
  rubric_sha256: string;
  controls: { defect: KnownDefect; judge_pass: boolean; reason: string }[];
}

/** The fingerprint that ties a calibration to the rubric it was made under (03: a rubric changed after agreement is informational). */
export const rubricFingerprint = (rubric: string): string =>
  createHash('sha256').update(rubric).digest('hex');

/** What graded a run: the rubric's fingerprint and the judge model. */
export interface Grading {
  rubricSha256: string;
  judgeModel: string;
}

/** Throws unless the run was graded as the judge would grade now: its verdicts and new ones must share a rubric and a judge. */
export function assertGradedAsNow(run: Grading, now: Grading): void {
  if (
    run.rubricSha256 !== now.rubricSha256 ||
    run.judgeModel !== now.judgeModel
  ) {
    throw new Error(
      `the latest full run was graded by ${run.judgeModel} under another rubric or judge than now (${now.judgeModel}): run pnpm eval again before exporting`,
    );
  }
}

interface JudgeTokens {
  promptTokens: number;
  completionTokens: number;
}

const verdictOf = (rowId: string, rubric: GradingResult): JudgeVerdict => {
  if (rubric.metadata?.['graderError'] === true) {
    throw new Error(
      maskPii(`the judge was not reached for ${rowId}: ${rubric.reason}`),
    );
  }
  return {
    row_id: rowId,
    judge_pass: rubric.pass,
    judge_reason: maskPii(rubric.reason),
  };
};

/** Judges each input once with the groundedness rubric, through promptfoo as the eval run does. */
async function judgeAll(
  inputs: ReadonlyMap<string, JudgeInput>,
  groundedness: Assertion,
  grader: Grader,
): Promise<{ verdicts: JudgeVerdict[]; tokens: JudgeTokens }> {
  const judged = await judgeEach(inputs, groundedness, grader);
  const tokens = { promptTokens: 0, completionTokens: 0 };
  for (const rubric of judged.values()) {
    tokens.promptTokens += rubric.tokensUsed?.prompt ?? 0;
    tokens.completionTokens += rubric.tokensUsed?.completion ?? 0;
  }
  return {
    verdicts: [...judged].map(([rowId, rubric]) => verdictOf(rowId, rubric)),
    tokens,
  };
}

/**
 * `pnpm eval:judgments` (03 §Judge validation, steps 2 and 3): judges the
 * seven known-bad controls and about 14 mutation negatives of a run's
 * drafts, then writes the blinded rows, the key, the verdicts and the
 * controls record into `dir`. Refuses while `labels.jsonl` exists, since
 * new opaque ids would no longer match the labels.
 */
export async function exportJudgments(input: {
  results: readonly GradedResult[];
  grader: Grader;
  judgeModel: string;
  rubric: string;
  random: () => number;
  dir: string;
}): Promise<{
  rows: number;
  ungraded: number;
  unreplied: number;
  controlsFailed: number;
  judgeCostUsd: number;
}> {
  const labelsExist = await access(join(input.dir, FILES.labels)).then(
    () => true,
    () => false,
  );
  if (labelsExist) {
    throw new Error(
      `${FILES.labels} exists: move it aside before exporting new rows, or its ids would label the wrong drafts`,
    );
  }
  const groundedness = groundednessAssertion(input.rubric);
  const { rows, verdicts, ungraded, unreplied } = extractJudgments(
    input.results,
  );
  const negatives = mutationNegatives(rows, MUTATION_TARGET, input.random);
  const negativeJudgments = await judgeAll(
    new Map(negatives.map((row) => [row.row_id, row.judge_input])),
    groundedness,
    input.grader,
  );
  const controlJudgments = await judgeAll(
    new Map(JUDGE_CONTROLS.map(({ defect, input: draft }) => [defect, draft])),
    groundedness,
    input.grader,
  );
  const controls: ControlsRecord = {
    judge_model: input.judgeModel,
    rubric_sha256: rubricFingerprint(input.rubric),
    controls: JUDGE_CONTROLS.map(({ defect }) => {
      const verdict = controlJudgments.verdicts.find(
        ({ row_id }) => row_id === defect,
      );
      if (!verdict) throw new Error(`control ${defect} came back unjudged`);
      return {
        defect,
        judge_pass: verdict.judge_pass,
        reason: verdict.judge_reason,
      };
    }),
  };
  const all: CalibrationRow[] = [...rows, ...negatives];
  const blinded = blindRows(
    all,
    [...verdicts, ...negativeJudgments.verdicts],
    input.random,
  );
  await writeFile(join(input.dir, FILES.toLabel), toJsonl(blinded.toLabel));
  await writeFile(join(input.dir, FILES.key), toJsonl(blinded.keys));
  await writeFile(join(input.dir, FILES.judgments), toJsonl(blinded.verdicts));
  await writeFile(
    join(input.dir, FILES.controls),
    `${JSON.stringify(controls, null, JSON_INDENT)}\n`,
  );
  return {
    rows: all.length,
    ungraded,
    unreplied,
    controlsFailed: controls.controls.filter(({ judge_pass }) => !judge_pass)
      .length,
    judgeCostUsd: judgeCostUsd(input.judgeModel, {
      promptTokens:
        negativeJudgments.tokens.promptTokens +
        controlJudgments.tokens.promptTokens,
      completionTokens:
        negativeJudgments.tokens.completionTokens +
        controlJudgments.tokens.completionTokens,
    }),
  };
}
