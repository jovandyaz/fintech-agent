import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readIfThere } from '../files.js';
import { KNOWN_DEFECTS } from '../judge/controls.js';
import { groundednessRubric, judgeProvider } from '../judge/groundedness.js';
import { latestRunRecord } from '../results.js';
import { prepareRun } from '../run.js';
import {
  assertGradedAsNow,
  exportJudgments,
  rubricFingerprint,
} from './judgments.js';

const CALIBRATION_DIR = import.meta.dirname;
const RANDOM_RANGE = 2 ** 32;
const USD_DIGITS = 4;

async function main(): Promise<void> {
  const { settings } = prepareRun({
    processEnv: process.env,
    dotEnv: await readIfThere(resolve(CALIBRATION_DIR, '../../.env')),
    envExample: readFileSync(
      resolve(CALIBRATION_DIR, '../../.env.example'),
      'utf8',
    ),
    target: process.env,
  });
  const record = await latestRunRecord(resolve(CALIBRATION_DIR, '../results'));
  const rubric = groundednessRubric();
  assertGradedAsNow(record.meta, {
    rubricSha256: rubricFingerprint(rubric),
    judgeModel: settings.JUDGE_MODEL,
  });
  const outcome = await exportJudgments({
    results: record.results,
    grader: judgeProvider(settings.JUDGE_MODEL),
    judgeModel: settings.JUDGE_MODEL,
    rubric,
    random: () => randomInt(RANDOM_RANGE) / RANDOM_RANGE,
    dir: CALIBRATION_DIR,
  });
  console.log(
    `${outcome.rows} rows to label (${outcome.ungraded} first attempts the judge never reached left out); the judge failed ${outcome.controlsFailed} of ${KNOWN_DEFECTS.length} known-bad controls; judge cost $${outcome.judgeCostUsd.toFixed(USD_DIGITS)}`,
  );
}

if (process.argv[1] === import.meta.filename) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
