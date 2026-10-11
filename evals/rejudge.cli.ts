import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  acceptedDraftOf,
  JudgeInputSchema,
  type EvalRun,
  type JudgeInput,
} from '@fintech-agent/api/evals';
import type { GradingResult } from 'promptfoo';

import { EVAL_CASES } from './cases.js';
import { rubricFingerprint } from './calibration/judgments.js';
import { judgeStanding } from './calibration/standing.js';
import { fromCallerDir, readIfThere } from './files.js';
import {
  groundednessAssertion,
  groundednessRubric,
  judgeProvider,
  RUBRIC_ASSERTION,
  type Grader,
} from './judge/groundedness.js';
import { judgeEach } from './judge/judge-each.js';
import {
  latestRunFile,
  METADATA,
  parseRunRecord,
  readBaseline,
  rejudgedFileOf,
  rubricOf,
  slimComponent,
  storedRun,
  type RunRecord,
} from './results.js';
import { gitSha, keyForTheJudge, variantOf } from './runtime.js';
import { runnerEnv, runnerSettings } from './settings.js';
import { judgeSpend, summarize, type RecordedResult } from './summary.js';

const EVALS_DIR = import.meta.dirname;
const USD_DIGITS = 4;
const PER_CALL_USD_DIGITS = 6;
const JSON_INDENT = 2;
const NEW_FILE_ONLY = 'wx';
const USAGE = 'usage: pnpm eval:rejudge <results file> [--dry-run]';

const usd = (value: number, digits = USD_DIGITS): string =>
  `$${value.toFixed(digits)}`;

const counted = (n: number, noun: string): string =>
  `${n} ${noun}${n === 1 ? '' : 's'}`;

const attemptOf = (result: RecordedResult): string =>
  `${variantOf(result.provider)} ${String(result.vars['case_id'])} (attempt ${String(result.response?.metadata?.[METADATA.repeatIndex])})`;

const usedJudgeTokens = (result: RecordedResult): boolean => {
  const used = rubricOf(result)?.tokensUsed;
  return (used?.prompt ?? 0) + (used?.completion ?? 0) > 0;
};

interface StoredAttempt {
  result: RecordedResult;
  run: EvalRun;
  /** Under 03 §Judge validation; null for a run that persisted no reply. */
  judgeInput: JudgeInput | null;
}

/**
 * One stored attempt with its judge input rebuilt under 03's rule: the
 * accepted model draft, placeholders unfilled, from the stored model
 * outputs; the cited chunks and tool outputs from the stored judge input.
 */
function storedAttempt(result: RecordedResult): StoredAttempt {
  const metadata = result.response?.metadata;
  if (metadata?.[METADATA.run] === undefined) {
    throw new Error(`${attemptOf(result)} recorded no run to re-judge`);
  }
  const run = storedRun(metadata[METADATA.run]);
  const draft = acceptedDraftOf(run);
  if (draft === null) return { result, run, judgeInput: null };
  const judged = JudgeInputSchema.safeParse(metadata[METADATA.judgeInput]);
  if (!judged.success) {
    throw new Error(
      `${attemptOf(result)} recorded no judge input to take its chunks and tool outputs from`,
    );
  }
  return { result, run, judgeInput: { ...judged.data, draft_reply: draft } };
}

/** What a re-judge will spend, known before its first call. */
interface RejudgePlan {
  calls: number;
  unreplied: number;
  perCallUsd: number;
  estimateUsd: number;
}

/**
 * The judge calls ahead, priced at what the record's judge calls on a draft
 * cost: a call on a run with no reply read nothing and cost less, and the
 * re-judge makes none.
 */
function planOf(
  record: RunRecord,
  attempts: readonly StoredAttempt[],
  name: string,
): RejudgePlan {
  const replied = attempts.filter(({ judgeInput }) => judgeInput !== null);
  const pricedCalls = replied
    .map(({ result }) => result)
    .filter(usedJudgeTokens);
  if (pricedCalls.length === 0) {
    throw new Error(
      `${name} records no judge call on a draft to estimate the cost from`,
    );
  }
  const perCallUsd =
    judgeSpend(pricedCalls, record.meta.judgeModel).costUsd /
    pricedCalls.length;
  return {
    calls: replied.length,
    unreplied: attempts.length - replied.length,
    perCallUsd,
    estimateUsd: perCallUsd * replied.length,
  };
}

/** The attempt as re-judged: its rebuilt judge input and the new verdict in place of the old one. */
function rejudged(
  attempt: StoredAttempt,
  rubric: GradingResult,
): RecordedResult {
  const { result, run, judgeInput } = attempt;
  return {
    ...result,
    response: {
      ...result.response,
      metadata: {
        ...result.response?.metadata,
        [METADATA.run]: { ...run, judge_input: judgeInput },
        [METADATA.judgeInput]: judgeInput,
      },
    },
    gradingResult: {
      ...result.gradingResult,
      componentResults: [
        ...(result.gradingResult?.componentResults ?? []).filter(
          ({ assertion }) => assertion?.type !== RUBRIC_ASSERTION,
        ),
        slimComponent(rubric),
      ],
    },
  };
}

/** Throws unless `record` can be re-judged as is: complete, the newest, by the same judge under the same rubric. */
async function assertRejudgeable(
  record: RunRecord,
  path: string,
  current: { judgeModel: string; rubricSha256: string },
): Promise<void> {
  const name = basename(path);
  if (record.summary === null || record.meta.incomplete.length > 0) {
    throw new Error(
      `${name} is an incomplete run, which is never reported: nothing to re-judge`,
    );
  }
  if (record.meta.judgeModel !== current.judgeModel) {
    throw new Error(
      `${name} was judged by ${record.meta.judgeModel}, but JUDGE_MODEL is ${current.judgeModel}: a re-judge keeps the run's judge`,
    );
  }
  if (record.meta.rubricSha256 !== current.rubricSha256) {
    throw new Error(
      `the rubric changed since ${name} was judged: a changed rubric is a new run (03 §Judge validation, rule 4), not a re-judge`,
    );
  }
  const newest = (await latestRunFile(dirname(path))).name;
  if (newest !== name) {
    throw new Error(
      `${name} is not the newest complete run, ${newest} is: re-judge the run that eval:report and eval:judgments read`,
    );
  }
}

/**
 * `pnpm eval:rejudge` (03 §Judge validation): judges the newest complete
 * run again under the rule that the judge reads the model's accepted draft
 * unfilled, without re-running the agents: same `JUDGE_MODEL`, rubric and
 * judge wrapper as `pnpm eval`, a run with no reply not judged. Before any
 * call it prints the calls and their cost estimated from the run's own
 * judge spend, refuses an estimate past `EVAL_SPEND_CAP_USD`, and only then
 * needs the key. Writes the re-judged record beside the input, which it
 * never touches, keeping what the first judging cost; returns its path, or
 * null on a dry run.
 */
export async function rejudgeFile(input: {
  path: string;
  processEnv: NodeJS.ProcessEnv;
  dotEnv: string | null;
  envExample: string;
  /** Where the key goes for the judge's provider: the process environment in the CLI. */
  target: NodeJS.ProcessEnv;
  judgeOf: (model: string) => Grader;
  rubric: string;
  calibrationDir: string;
  baseline: string;
  dryRun: boolean;
  clock: () => Date;
  commit: string;
  log: (line: string) => void;
}): Promise<string | null> {
  const name = basename(input.path);
  const record = parseRunRecord(await readFile(input.path, 'utf8'));
  const env = runnerEnv(input.processEnv, input.dotEnv);
  const settings = runnerSettings(env, input.envExample);
  const judgeModel = settings.JUDGE_MODEL;
  const rubricSha256 = rubricFingerprint(input.rubric);
  await assertRejudgeable(record, input.path, { judgeModel, rubricSha256 });
  const attempts = record.results.map(storedAttempt);
  const plan = planOf(record, attempts, name);
  input.log(
    `${counted(plan.calls, 'judge call')} (${counted(plan.unreplied, 'attempt')} with no reply not judged), estimated ${usd(plan.estimateUsd)} at ${usd(plan.perCallUsd, PER_CALL_USD_DIGITS)} per call, from ${name}'s own judge spend`,
  );
  const capUsd = settings.EVAL_SPEND_CAP_USD;
  if (plan.estimateUsd > capUsd) {
    throw new Error(
      `the estimated ${usd(plan.estimateUsd)} passes EVAL_SPEND_CAP_USD ($${capUsd}): nothing judged`,
    );
  }
  if (input.dryRun) return null;
  keyForTheJudge(env, input.target);

  const judged = await judgeEach(
    new Map(
      attempts.map(({ judgeInput }, index) => [String(index), judgeInput]),
    ),
    groundednessAssertion(input.rubric),
    input.judgeOf(judgeModel),
  );
  const results = attempts.map((attempt, index) => {
    const rubric = judged.get(String(index));
    if (!rubric) {
      throw new Error(`${attemptOf(attempt.result)} came back unjudged`);
    }
    return rejudged(attempt, rubric);
  });
  const meta: RunRecord['meta'] = {
    ...record.meta,
    timestamp: input.clock().toISOString(),
    rejudgedFrom: {
      file: name,
      judgeCostUsd: judgeSpend(record.results, judgeModel).costUsd,
    },
  };
  const standing = await judgeStanding(input.calibrationDir, {
    rubricSha256,
    judgeModel,
  });
  const summary = summarize({
    results,
    cases: EVAL_CASES.filter(({ id }) => meta.caseIds.includes(id)),
    variants: meta.variants,
    judgeModel,
    judgeCounts: standing.counts,
    baseline: await readBaseline(input.baseline),
    full: meta.full,
    date: meta.date,
    commit: meta.commit,
    redactor: record.summary?.redactor ?? null,
  });
  const written = join(
    dirname(input.path),
    rejudgedFileOf(name, input.commit, meta.timestamp),
  );
  await writeFile(
    written,
    `${JSON.stringify({ meta, summary, results }, null, JSON_INDENT)}\n`,
    { flag: NEW_FILE_ONLY },
  );
  const spentUsd = summary.costUsd.judge;
  input.log(
    `judge spend ${usd(spentUsd)} (estimated ${usd(plan.estimateUsd)}) of the $${capUsd} cap`,
  );
  if (spentUsd > capUsd) {
    input.log(
      `warning: the judge spent ${usd(spentUsd)}, past EVAL_SPEND_CAP_USD ($${capUsd})`,
    );
  }
  input.log(`results: ${written}`);
  return written;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    allowPositionals: true,
    options: { 'dry-run': { type: 'boolean', default: false } },
  });
  const [file] = positionals;
  if (positionals.length !== 1 || file === undefined) throw new Error(USAGE);
  await rejudgeFile({
    path: fromCallerDir(file),
    processEnv: process.env,
    dotEnv: await readIfThere(resolve(EVALS_DIR, '../.env')),
    envExample: readFileSync(resolve(EVALS_DIR, '../.env.example'), 'utf8'),
    target: process.env,
    judgeOf: judgeProvider,
    rubric: groundednessRubric(),
    calibrationDir: resolve(EVALS_DIR, 'calibration'),
    baseline: resolve(EVALS_DIR, 'baseline.json'),
    dryRun: values['dry-run'],
    clock: () => new Date(),
    commit: gitSha(),
    log: (line) => console.log(line),
  });
}

if (process.argv[1] === import.meta.filename) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
