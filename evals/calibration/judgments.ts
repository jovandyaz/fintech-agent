import { createHash } from 'node:crypto';
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { JudgeInput } from '@fintech-agent/api/evals';
import { maskPii } from '@fintech-agent/contracts';
import type {
  ApiProvider,
  Assertion,
  EvaluateResult,
  ProviderOptions,
} from 'promptfoo';

import { groundednessAssertion } from '../judge/groundedness.js';
import { JUDGE_CONTROLS, type KnownDefect } from '../judge/controls.js';
import { judgeText } from '../judge/text.js';
import { runEvalSuite } from '../runtime.js';
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
const JUDGE_CONCURRENCY = 4;
const ROW_KEY = 'row_id';
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

const verdictOf = (result: EvaluateResult): JudgeVerdict => {
  const rowId = result.vars[ROW_KEY];
  const rubric = result.gradingResult?.componentResults?.[0];
  if (typeof rowId !== 'string' || !rubric) {
    throw new Error('a judged row came back with no verdict');
  }
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
): Promise<JudgeVerdict[]> {
  const provider: ApiProvider = {
    id: () => 'calibration',
    callApi: (_prompt, context) => {
      const rowId = context?.vars[ROW_KEY];
      const input = typeof rowId === 'string' ? inputs.get(rowId) : undefined;
      if (!input) throw new Error('a calibration test names no row');
      return Promise.resolve({ output: judgeText(input) });
    },
  };
  const results = await runEvalSuite(
    {
      providers: [provider],
      prompts: [`{{${ROW_KEY}}}`],
      tests: [...inputs.keys()].map((rowId) => ({
        vars: { [ROW_KEY]: rowId },
        assert: [groundedness],
      })),
    },
    { maxConcurrency: JUDGE_CONCURRENCY },
  );
  return results.map(verdictOf);
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
  grader: ApiProvider | ProviderOptions;
  judgeModel: string;
  rubric: string;
  random: () => number;
  dir: string;
}): Promise<{ rows: number; ungraded: number; controlsFailed: number }> {
  const labelsExist = await access(join(input.dir, FILES.labels)).then(
    () => true,
    () => false,
  );
  if (labelsExist) {
    throw new Error(
      `${FILES.labels} exists: move it aside before exporting new rows, or its ids would label the wrong drafts`,
    );
  }
  const groundedness = groundednessAssertion(input.grader, input.rubric);
  const { rows, verdicts, ungraded } = extractJudgments(input.results);
  const negatives = mutationNegatives(rows, MUTATION_TARGET, input.random);
  const negativeVerdicts = await judgeAll(
    new Map(negatives.map((row) => [row.row_id, row.judge_input])),
    groundedness,
  );
  const controlVerdicts = await judgeAll(
    new Map(JUDGE_CONTROLS.map(({ defect, input: draft }) => [defect, draft])),
    groundedness,
  );
  const controls: ControlsRecord = {
    judge_model: input.judgeModel,
    rubric_sha256: rubricFingerprint(input.rubric),
    controls: JUDGE_CONTROLS.map(({ defect }) => {
      const verdict = controlVerdicts.find(({ row_id }) => row_id === defect);
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
    [...verdicts, ...negativeVerdicts],
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
    controlsFailed: controls.controls.filter(({ judge_pass }) => !judge_pass)
      .length,
  };
}
