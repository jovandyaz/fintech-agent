import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import {
  JudgeInputSchema,
  ToolOutputSchema,
  type EvalRun,
} from '@fintech-agent/api/evals';
import { maskPii } from '@fintech-agent/contracts';
import type { EvaluateResult, GradingResult } from 'promptfoo';
import { z } from 'zod';

import { readIfThere } from './files.js';
import { RUBRIC_ASSERTION } from './judge/groundedness.js';
import type { Baseline } from './report.js';
import type { RecordedResult, RunSummary } from './summary.js';

const REJUDGED = '-rejudged-';
const RESULTS_FILE = new RegExp(
  String.raw`^\d{4}-\d{2}-\d{2}-[0-9a-f]+-\d{6}Z(-[a-z]+)?(${REJUDGED}[0-9a-f]+-\d{6}Z)*\.json$`,
);
const JSON_SUFFIX = '.json';
const JSON_INDENT = 2;
const NOT_FOUND = 'ENOENT';
const CLOCK_DIGITS = /\D/g;
const TIME_START = 11;
const TIME_END = 19;

/** What a run leaves in `evals/results/` (03 §Runner). */
export interface RunRecord {
  meta: {
    /** When the run, or its latest re-judge, finished, ISO 8601: what "latest" sorts by. */
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
    /** On a re-judged record: the record it re-judged and what judging it cost then. */
    rejudgedFrom?: { file: string; judgeCostUsd: number } | undefined;
  };
  /** Null for an incomplete run, whose numbers would read as a result. */
  summary: RunSummary | null;
  results: RecordedResult[];
}

/** The keys the provider writes into each result's metadata, and every reader takes them back by. */
export const METADATA = {
  run: 'run',
  repeatIndex: 'repeat_index',
  judgeInput: 'judge_input',
  customerText: 'customer_text',
} as const;

/** A result's groundedness verdict; undefined where the judge was never asked. */
export const rubricOf = <
  Component extends {
    assertion?: { type?: string | undefined } | null | undefined;
  },
>(result: {
  gradingResult?:
    | { componentResults?: readonly Component[] | null | undefined }
    | null
    | undefined;
}): Component | undefined =>
  result.gradingResult?.componentResults?.find(
    ({ assertion }) => assertion?.type === RUBRIC_ASSERTION,
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const RecordedComponentSchema = z.object({
  pass: z.boolean(),
  reason: z.string(),
  assertion: z.object({ type: z.string().optional() }).nullish(),
  metadata: z.object({ graderError: z.boolean().optional() }).optional(),
  tokensUsed: z
    .object({
      prompt: z.number().optional(),
      completion: z.number().optional(),
    })
    .optional(),
});

const RecordedResultSchema = z.object({
  vars: z.record(z.string(), z.unknown()),
  error: z.string().nullish(),
  provider: z.object({
    id: z.string().optional(),
    label: z.string().optional(),
  }),
  response: z
    .object({ metadata: z.record(z.string(), z.unknown()).optional() })
    .optional(),
  gradingResult: z
    .object({ componentResults: z.array(RecordedComponentSchema).nullish() })
    .nullish(),
});

const RunRecordSchema = z.object({
  meta: z.object({
    timestamp: z.string(),
    date: z.string(),
    commit: z.string(),
    judgeModel: z.string(),
    rubricSha256: z.string(),
    variants: z.array(z.string()),
    caseIds: z.array(z.string()),
    full: z.boolean(),
    incomplete: z.array(z.string()),
    rejudgedFrom: z
      .object({ file: z.string(), judgeCostUsd: z.number() })
      .optional(),
  }),
  // Every reader recomputes the summary from the results; only its
  // redactor recall, which no result holds, is read back.
  summary: z.custom<RunSummary>(isRecord).nullable(),
  results: z.array(RecordedResultSchema),
});

/** A results file's text as a run record; throws naming the first field that does not parse. */
export function parseRunRecord(text: string): RunRecord {
  return RunRecordSchema.parse(JSON.parse(text));
}

const StoredRunSchema = z.looseObject({
  draft_reply: z.string().nullable(),
  model_outputs: z.array(z.record(z.string(), z.unknown())),
  validations: z.array(
    z.object({ outcome: z.string(), codes: z.array(z.string()) }),
  ),
  tool_outputs: z.array(ToolOutputSchema).optional(),
  judge_input: JudgeInputSchema.nullable(),
});

/**
 * A run as a results file holds it, parsed where the judge and the reply
 * checks read it. Files written before a run without a reply could go
 * unjudged keep its tool outputs only in its judge input, which every run
 * then had.
 */
export function storedRun(value: unknown): EvalRun {
  const { tool_outputs, ...run } = StoredRunSchema.parse(value);
  return {
    ...(run as unknown as Omit<EvalRun, 'tool_outputs'>),
    tool_outputs: tool_outputs ?? run.judge_input?.tool_outputs ?? [],
  };
}

type RecordedComponent = NonNullable<
  NonNullable<
    NonNullable<RecordedResult['gradingResult']>['componentResults']
  >[number]
>;

/** One assertion's verdict as a results file keeps it: the reason masked (02 G6), the judge's tokens, whether its grader was reached. */
export const slimComponent = (component: GradingResult): RecordedComponent => ({
  pass: component.pass,
  reason: maskPii(component.reason),
  assertion: { type: component.assertion?.type },
  metadata: { graderError: component.metadata?.['graderError'] === true },
  tokensUsed: {
    prompt: component.tokensUsed?.prompt,
    completion: component.tokensUsed?.completion,
  },
});

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
        slimComponent,
      ),
    },
  };
}

const clockOf = (timestamp: string): string =>
  timestamp.slice(TIME_START, TIME_END).replaceAll(CLOCK_DIGITS, '');

/**
 * `<date>-<commit>-<hhmmss>Z.json`, `-subset` or `-incomplete` appended: a
 * run never overwrites an earlier one of the same commit.
 */
export const resultsFileOf = (meta: RunRecord['meta']): string => {
  const scope =
    meta.incomplete.length > 0 ? '-incomplete' : meta.full ? '' : '-subset';
  return `${meta.date}-${meta.commit}-${clockOf(meta.timestamp)}Z${scope}.json`;
};

/**
 * `<re-judged file>-rejudged-<commit>-<hhmmss>Z.json`, beside the record it
 * re-judges (`pnpm eval:rejudge`, 03 §Judge validation): never the same
 * name, and still a record `latestRunRecord` reads.
 */
export const rejudgedFileOf = (
  rejudgedName: string,
  commit: string,
  timestamp: string,
): string =>
  `${basename(rejudgedName, JSON_SUFFIX)}${REJUDGED}${commit}-${clockOf(timestamp)}Z${JSON_SUFFIX}`;

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
 * The newest complete full run in `dir` by its timestamp, with its file
 * name: the one EVALS.md and the calibration read. Subset and incomplete
 * runs are skipped; throws naming the step that writes one.
 */
export async function latestRunFile(
  dir: string,
): Promise<{ name: string; record: RunRecord }> {
  const names = (
    await readdir(dir).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === NOT_FOUND) return [];
      throw error;
    })
  ).filter((name) => RESULTS_FILE.test(name));
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      record: parseRunRecord(await readFile(join(dir, name), 'utf8')),
    })),
  );
  const latest = files
    .filter(
      ({ record: { meta, summary } }) =>
        meta.full && meta.incomplete.length === 0 && summary !== null,
    )
    .sort((a, b) =>
      a.record.meta.timestamp.localeCompare(b.record.meta.timestamp),
    )
    .at(-1);
  if (!latest) {
    throw new Error(
      `no complete full run record in ${dir}: run pnpm eval with no --only, --variant or --repeat first`,
    );
  }
  return latest;
}

/** The record of `latestRunFile`. */
export const latestRunRecord = async (dir: string): Promise<RunRecord> =>
  (await latestRunFile(dir)).record;

/** The committed baseline, or null before the first run sets one. */
export async function readBaseline(path: string): Promise<Baseline | null> {
  const text = await readIfThere(path);
  return text === null ? null : (JSON.parse(text) as Baseline);
}

/** Why a run sets no baseline; the runner and eval:report print it. */
export const BASELINE_REFUSED =
  'baseline not written: it comes only from a complete full run (no --only, --variant or --repeat), from the variants that blocked every attack with no execution';

/** The baseline a run may set: a full run with at least one variant that blocked every attack; null otherwise. */
export const settableBaseline = (
  baseline: Baseline,
  full: boolean,
): Baseline | null =>
  full && Object.keys(baseline.high_stakes_passed).length > 0 ? baseline : null;

/** Writes `evals/baseline.json`, one object, newline-terminated. */
export async function writeBaseline(
  path: string,
  baseline: Baseline,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(baseline, null, JSON_INDENT)}\n`);
}
