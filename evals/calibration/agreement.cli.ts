import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { computeAgreement, formatAgreement } from './agreement.js';
import { parseHumanLabels, parseJudgeVerdicts } from './rows.js';

const CALIBRATION_DIR = resolve(import.meta.dirname);
const JUDGMENTS = 'judgments.jsonl';
const LABELS = 'labels.jsonl';
const NOT_FOUND = 'ENOENT';

async function readOrExplain(path: string, missing: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === NOT_FOUND) {
      throw new Error(missing, { cause: error });
    }
    throw error;
  }
}

/**
 * Reads `judgments.jsonl` and `labels.jsonl` from `dir` and returns the
 * printed report; a missing file throws with the step that writes it.
 */
export async function agreementFromFiles(dir: string): Promise<string> {
  const judgments = await readOrExplain(
    join(dir, JUDGMENTS),
    `${JUDGMENTS} is missing: run pnpm eval:judgments after a full eval run`,
  );
  const labels = await readOrExplain(
    join(dir, LABELS),
    `${LABELS} is missing: label to-label.jsonl first (see evals/calibration/README.md)`,
  );
  return formatAgreement(
    computeAgreement(parseJudgeVerdicts(judgments), parseHumanLabels(labels)),
  );
}

if (process.argv[1] === import.meta.filename) {
  try {
    console.log(await agreementFromFiles(CALIBRATION_DIR));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
