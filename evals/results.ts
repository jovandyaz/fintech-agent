import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { maskPii } from '@fintech-agent/contracts';
import type { EvaluateResult } from 'promptfoo';

import { readIfThere } from './files.js';
import type { Baseline } from './report.js';
import type { RecordedResult, RunSummary } from './summary.js';

const RESULTS_FILE = /^\d{4}-\d{2}-\d{2}-[0-9a-f]+-\d{6}Z(-[a-z]+)?\.json$/;
const JSON_INDENT = 2;
const NOT_FOUND = 'ENOENT';
const CLOCK_DIGITS = /\D/g;
const TIME_START = 11;
const TIME_END = 19;

/** What a run leaves in `evals/results/` (03 §Runner). */
export interface RunRecord {
  meta: {
    /** When the run finished, ISO 8601: what "latest" sorts by. */
    timestamp: string;
    date: string;
    commit: string;
    judgeModel: string;
    /** The rubric the judge graded under; a calibration applies only to the same one. */
    rubricSha256: string;
    variants: string[];
    caseIds: string[];
    /** Every case on both variants at the 3 / 1 split: the run 03's decision and calibration read. */
    full: boolean;
    /** Case and variant attempts that reached no verdict; a record with any is never reported. */
    incomplete: string[];
  };
  /** Null for an incomplete run, whose numbers would read as a result. */
  summary: RunSummary | null;
  results: RecordedResult[];
}

/**
 * The part of a promptfoo result the reports and the calibration read: the
 * case, the variant, the recorded attempt and each assertion's verdict.
 * The rest (the test with its assertion functions, the prompt) is dropped.
 */
export function slimResult(result: EvaluateResult): RecordedResult {
  return {
    vars: result.vars,
    provider: { id: result.provider.id, label: result.provider.label },
    ...(result.error ? { error: maskPii(result.error) } : {}),
    response: { metadata: result.response?.metadata },
    gradingResult: {
      componentResults: (result.gradingResult?.componentResults ?? []).map(
        (component) => ({
          pass: component.pass,
          reason: maskPii(component.reason),
          assertion: { type: component.assertion?.type },
          metadata: { graderError: component.metadata?.graderError === true },
          tokensUsed: {
            prompt: component.tokensUsed?.prompt,
            completion: component.tokensUsed?.completion,
          },
        }),
      ),
    },
  };
}

/**
 * `<date>-<commit>-<hhmmss>Z.json`, `-subset` or `-incomplete` appended: a
 * run never overwrites an earlier one of the same commit.
 */
export const resultsFileOf = (meta: RunRecord['meta']): string => {
  const time = meta.timestamp
    .slice(TIME_START, TIME_END)
    .replaceAll(CLOCK_DIGITS, '');
  const scope =
    meta.incomplete.length > 0 ? '-incomplete' : meta.full ? '' : '-subset';
  return `${meta.date}-${meta.commit}-${time}Z${scope}.json`;
};

/** Creates `dir` when missing and returns the record's path. */
export async function writeRunRecord(
  dir: string,
  record: RunRecord,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, resultsFileOf(record.meta));
  await writeFile(path, `${JSON.stringify(record, null, JSON_INDENT)}\n`);
  return path;
}

/**
 * The newest complete full run in `dir` by its timestamp: the one EVALS.md
 * and the calibration read. Subset and incomplete runs are skipped; throws
 * naming the step that writes one.
 */
export async function latestRunRecord(dir: string): Promise<RunRecord> {
  const names = (
    await readdir(dir).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === NOT_FOUND) return [];
      throw error;
    })
  ).filter((name) => RESULTS_FILE.test(name));
  const records = await Promise.all(
    names.map(
      async (name) =>
        JSON.parse(await readFile(join(dir, name), 'utf8')) as RunRecord,
    ),
  );
  const latest = records
    .filter(
      ({ meta, summary }) =>
        meta.full && meta.incomplete.length === 0 && summary !== null,
    )
    .sort((a, b) => a.meta.timestamp.localeCompare(b.meta.timestamp))
    .at(-1);
  if (!latest) {
    throw new Error(
      `no complete full run record in ${dir}: run pnpm eval with no --only, --variant or --repeat first`,
    );
  }
  return latest;
}
/** The committed baseline, or null before the first run sets one. */
export async function readBaseline(path: string): Promise<Baseline | null> {
  const text = await readIfThere(path);
  return text === null ? null : (JSON.parse(text) as Baseline);
}
