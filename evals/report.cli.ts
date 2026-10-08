import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { EVAL_CASES } from './cases.js';
import { readIfThere } from './files.js';
import { judgeStanding, standingLines } from './calibration/standing.js';
import {
  BASELINE_REFUSED,
  latestRunRecord,
  readBaseline,
  settableBaseline,
  writeBaseline,
} from './results.js';
import { markdownSummary, summarize } from './summary.js';

const EVALS_DIR = import.meta.dirname;
const START = '<!-- evals:summary:start -->';
const END = '<!-- evals:summary:end -->';
const BLOCK_BREAK = '\n\n';
const WRITE_BASELINE = '--write-baseline';

/** `document` with the text between the summary markers replaced by `block`; throws when the markers are missing or out of order. */
export function replaceSummaryBlock(document: string, block: string): string {
  const start = document.indexOf(START);
  const end = document.indexOf(END);
  if (start < 0 || end < start) {
    throw new Error(`EVALS.md has no ${START} … ${END} block to write into`);
  }
  return `${document.slice(0, start + START.length)}${BLOCK_BREAK}${block}${BLOCK_BREAK}${document.slice(end)}`;
}

/**
 * `pnpm eval:report`: re-grades the latest complete full run under the
 * current checkers and the committed baseline, and writes its summary into
 * EVALS.md, the decision taken under the judge's current standing for the
 * rubric and judge that graded the run. With `writeBaseline`, it also sets
 * the baseline from that run's variants that blocked every attack.
 */
export async function reportIntoEvals(paths: {
  resultsDir: string;
  calibrationDir: string;
  evalsMd: string;
  baseline: string;
  writeBaseline: boolean;
}): Promise<void> {
  const record = await latestRunRecord(paths.resultsDir);
  const standing = await judgeStanding(paths.calibrationDir, {
    rubricSha256: record.meta.rubricSha256,
    judgeModel: record.meta.judgeModel,
  });
  const summary = summarize({
    results: record.results,
    cases: EVAL_CASES.filter(({ id }) => record.meta.caseIds.includes(id)),
    variants: record.meta.variants,
    judgeModel: record.meta.judgeModel,
    judgeCounts: standing.counts,
    baseline: await readBaseline(paths.baseline),
    full: record.meta.full,
    date: record.meta.date,
    commit: record.meta.commit,
    redactor: record.summary?.redactor ?? null,
  });
  const block = [markdownSummary(summary), '', ...standingLines(standing)].join(
    '\n',
  );
  const document = await readIfThere(paths.evalsMd);
  if (document === null) {
    throw new Error(
      `${paths.evalsMd} is missing: create it with a ${START} … ${END} block to write into`,
    );
  }
  await writeFile(paths.evalsMd, replaceSummaryBlock(document, block));
  if (paths.writeBaseline) {
    const baseline = settableBaseline(summary.baseline, record.meta.full);
    if (baseline === null) throw new Error(BASELINE_REFUSED);
    await writeBaseline(paths.baseline, baseline);
  }
}

if (process.argv[1] === import.meta.filename) {
  reportIntoEvals({
    resultsDir: resolve(EVALS_DIR, 'results'),
    calibrationDir: resolve(EVALS_DIR, 'calibration'),
    evalsMd: resolve(EVALS_DIR, '../EVALS.md'),
    baseline: resolve(EVALS_DIR, 'baseline.json'),
    writeBaseline: process.argv.includes(WRITE_BASELINE),
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
