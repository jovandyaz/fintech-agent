import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  evalHarness,
  runEvalCase,
  type EvalRun,
} from '@fintech-agent/api/evals';
import type { Assertion } from 'promptfoo';

import { spendCap, type SpendCap } from './budget.js';
import { EVAL_CASES, type EvalCase } from './cases.js';
import { rubricFingerprint } from './calibration/judgments.js';
import { readIfThere } from './files.js';
import type { CaseFixture } from './fixtures.js';
import {
  judgeStanding,
  standingLines,
  type JudgeStanding,
} from './calibration/standing.js';
import {
  groundednessAssertion,
  groundednessRubric,
  judgeProvider,
} from './judge/groundedness.js';
import {
  evalProvider,
  variantLabel,
  type EvalAttempt,
  type Variant,
} from './provider.js';
import type { Baseline } from './report.js';
import {
  readBaseline,
  slimResult,
  writeRunRecord,
  type RunRecord,
} from './results.js';
import {
  formatCaseOutcome,
  gitSha,
  keyForTheJudge,
  runEvalSuite,
  summarizeTrials,
  toTrialResult,
  type CaseOutcome,
} from './runtime.js';
import { runnerEnv, runnerSettings, type RunnerSettings } from './settings.js';
import { evalSuite, parseFlags, selectCases, type RunFlags } from './suite.js';
import { markdownSummary, summarize, type RecordedResult } from './summary.js';

const EVALS_DIR = import.meta.dirname;
const ENV_EXAMPLE = resolve(EVALS_DIR, '../.env.example');
const DOT_ENV = resolve(EVALS_DIR, '../.env');
const RESULTS_DIR = resolve(EVALS_DIR, 'results');
const BASELINE = resolve(EVALS_DIR, 'baseline.json');
const CALIBRATION_DIR = resolve(EVALS_DIR, 'calibration');
// 03 §Runner: four attempts in flight.
const MAX_CONCURRENCY = 4;
const JSON_INDENT = 2;
const DATE_LENGTH = 10;
const USD_DIGITS = 4;
const BOTH_VARIANTS = 2;
const FAILED = 1;
const PASSED = 0;

/**
 * One promptfoo run over `cases`, one provider per variant (03 §Runner):
 * every result slimmed for the results file, and the per-case outcomes.
 */
export async function runEvals(input: {
  cases: readonly EvalCase[];
  attempts: ReadonlyMap<Variant, EvalAttempt>;
  repeat: number | null;
  groundedness: Assertion;
}): Promise<{ results: RecordedResult[]; outcomes: CaseOutcome[] }> {
  const providers = [...input.attempts].map(([variant, attempt]) =>
    evalProvider({ variant, attempt }),
  );
  const results = await runEvalSuite(
    evalSuite({
      cases: input.cases,
      providers,
      repeat: input.repeat,
      groundedness: input.groundedness,
    }),
    { maxConcurrency: MAX_CONCURRENCY },
  );
  return {
    results: results.map(slimResult),
    outcomes: summarizeTrials(results.map(toTrialResult)),
  };
}

/** What a finished run leaves: its record, what it prints, its exit code and the baseline it sets, if any. */
export interface RunConclusion {
  record: RunRecord;
  lines: string[];
  exitCode: typeof PASSED | typeof FAILED;
  baseline: Baseline | null;
}

/**
 * Concludes a run (03 §Runner). An attempt that reached no verdict makes
 * the run incomplete: it is recorded without a summary, prints no result
 * and fails, so a down stack never reads as a 0%. A complete run prints
 * its summary and fails on the regression gate. `--write-baseline` sets
 * the baseline only from a complete full run the gate passed.
 */
export function concludeRun(input: {
  results: RecordedResult[];
  outcomes: readonly CaseOutcome[];
  cases: readonly EvalCase[];
  flags: RunFlags;
  judgeModel: string;
  rubricSha256: string;
  standing: JudgeStanding;
  baseline: Baseline | null;
  now: Date;
  commit: string;
  spend: { agentsUsd: number; capUsd: number };
}): RunConclusion {
  const timestamp = input.now.toISOString();
  const incomplete = input.outcomes
    .filter(({ unrunAttempts }) => unrunAttempts > 0)
    .map(
      ({ providerId, caseId, unrunAttempts }) =>
        `${providerId} ${caseId} (${unrunAttempts})`,
    );
  const full =
    input.flags.only === null &&
    input.flags.repeat === null &&
    input.flags.variants.length === BOTH_VARIANTS;
  const variants = input.flags.variants.map(variantLabel);
  const meta: RunRecord['meta'] = {
    timestamp,
    date: timestamp.slice(0, DATE_LENGTH),
    commit: input.commit,
    judgeModel: input.judgeModel,
    rubricSha256: input.rubricSha256,
    variants,
    caseIds: input.cases.map(({ id }) => id),
    full,
    incomplete,
  };
  const outcomeLines = input.outcomes.map(formatCaseOutcome);
  const spent = `agent spend $${input.spend.agentsUsd.toFixed(USD_DIGITS)} of the $${input.spend.capUsd} cap`;
  if (incomplete.length > 0) {
    return {
      record: { meta, summary: null, results: input.results },
      lines: [
        ...outcomeLines,
        spent,
        `attempts reached no verdict (the provider or a checker threw), so the run is incomplete and reports nothing: ${incomplete.join(', ')}`,
      ],
      exitCode: FAILED,
      baseline: null,
    };
  }
  const summary = summarize({
    results: input.results,
    cases: input.cases,
    variants,
    judgeModel: input.judgeModel,
    judgeCounts: input.standing.counts,
    baseline: input.baseline,
    full,
    date: meta.date,
    commit: input.commit,
  });
  const lines = [
    ...outcomeLines,
    markdownSummary(summary),
    '',
    ...standingLines(input.standing),
    spent,
  ];
  let exitCode: RunConclusion['exitCode'] =
    summary.gate.length > 0 ? FAILED : PASSED;
  let baseline: Baseline | null = null;
  if (input.flags.writeBaseline) {
    if (full && summary.gate.length === 0) {
      baseline = summary.baseline;
    } else {
      lines.push(
        'baseline not written: it comes only from a full run (no --only, --variant or --repeat) the regression gate passed',
      );
      exitCode = FAILED;
    }
  }
  return {
    record: { meta, summary, results: input.results },
    lines,
    exitCode,
    baseline,
  };
}

/**
 * Everything a run needs before its first paid call: the runner's
 * environment (the allowed keys of `.env` under the process environment),
 * the key handed to the judge's provider through `target`, and settings
 * that name a judge the price table holds. Throws instead of spending.
 */
export function prepareRun(input: {
  processEnv: NodeJS.ProcessEnv;
  dotEnv: string | null;
  envExample: string;
  target: NodeJS.ProcessEnv;
}): { env: NodeJS.ProcessEnv; settings: RunnerSettings } {
  const env = runnerEnv(input.processEnv, input.dotEnv);
  const settings = runnerSettings(env, input.envExample);
  keyForTheJudge(env, input.target);
  return { env, settings };
}

/** One attempt function per variant, all behind the same spend cap. */
export function cappedAttempts(
  variants: readonly Variant[],
  attempt: (variant: Variant, fixture: CaseFixture) => Promise<EvalRun>,
  cap: SpendCap,
): Map<Variant, EvalAttempt> {
  return new Map(
    variants.map((variant) => [
      variant,
      cap.guard((fixture) => attempt(variant, fixture)),
    ]),
  );
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const envExample = readFileSync(ENV_EXAMPLE, 'utf8');
  const { env, settings } = prepareRun({
    processEnv: process.env,
    dotEnv: await readIfThere(DOT_ENV),
    envExample,
    target: process.env,
  });
  const rubric = groundednessRubric();
  const rubricSha256 = rubricFingerprint(rubric);
  const standing = await judgeStanding(CALIBRATION_DIR, {
    rubricSha256,
    judgeModel: settings.JUDGE_MODEL,
  });
  const harness = evalHarness({
    env,
    envExample,
    log: (event) => console.error(JSON.stringify(event)),
  });
  const cap = spendCap(settings.EVAL_SPEND_CAP_USD);
  try {
    const left = await harness.failLeftovers(new Date());
    if (left.length > 0) {
      console.error(
        `failed ${left.length} eval cases an earlier run left behind`,
      );
    }
    const cases = selectCases(EVAL_CASES, flags.only);
    const { results, outcomes } = await runEvals({
      cases,
      attempts: cappedAttempts(
        flags.variants,
        (variant, fixture) => runEvalCase(harness.depsFor(variant), fixture),
        cap,
      ),
      repeat: flags.repeat,
      groundedness: groundednessAssertion(
        judgeProvider(settings.JUDGE_MODEL),
        rubric,
      ),
    });
    const conclusion = concludeRun({
      results,
      outcomes,
      cases,
      flags,
      judgeModel: settings.JUDGE_MODEL,
      rubricSha256,
      standing,
      baseline: await readBaseline(BASELINE),
      now: new Date(),
      commit: gitSha(),
      spend: {
        agentsUsd: cap.spentUsd(),
        capUsd: settings.EVAL_SPEND_CAP_USD,
      },
    });
    const path = await writeRunRecord(RESULTS_DIR, conclusion.record);
    for (const line of conclusion.lines) console.log(line);
    console.log(`results: ${path}`);
    if (conclusion.baseline) {
      await writeFile(
        BASELINE,
        `${JSON.stringify(conclusion.baseline, null, JSON_INDENT)}\n`,
      );
      console.log(`baseline: ${BASELINE}`);
    }
    process.exitCode = conclusion.exitCode;
  } finally {
    await harness.close();
  }
}

if (process.argv[1] === import.meta.filename) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
