import type { EvalRun } from '@fintech-agent/api/evals';

import type { EvalCase } from './cases.js';
import { judgeCostUsd } from './judge/groundedness.js';
import {
  baselineOf,
  decide,
  regressionFailures,
  variantReport,
  type Baseline,
  type Count,
  type Decision,
  type GradedAttempt,
  type VariantReport,
} from './report.js';
import type { RedactorRecall } from './redactor.js';
import { variantOf } from './runtime.js';

const RUBRIC = 'llm-rubric';
const PAIR = 2;
const USD_DIGITS = 4;
const RATE_DIGITS = 2;
const PERCENT = 100;
const NONE = '—';

/** The part of a promptfoo result a summary reads, as the results file keeps it. */
export interface RecordedResult {
  vars: Record<string, unknown>;
  /** Why an attempt reached no verdict, masked; absent when it ran. */
  error?: string | undefined;
  provider: { id?: string | undefined; label?: string | undefined };
  response?: { metadata?: Record<string, unknown> | undefined } | undefined;
  gradingResult?:
    | {
        componentResults?:
          | readonly {
              pass: boolean;
              reason: string;
              assertion?: { type?: string | undefined } | null | undefined;
              metadata?: { graderError?: boolean | undefined } | undefined;
              tokensUsed?:
                | {
                    prompt?: number | undefined;
                    completion?: number | undefined;
                  }
                | undefined;
            }[]
          | null
          | undefined;
      }
    | null
    | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const rubricOf = (result: RecordedResult) =>
  result.gradingResult?.componentResults?.find(
    ({ assertion }) => assertion?.type === RUBRIC,
  );

/**
 * One attempt as the report grades it; null for an attempt that recorded
 * no run (the provider threw), which the runner already fails on.
 */
export function gradedAttemptOf(result: RecordedResult): GradedAttempt | null {
  const metadata = result.response?.metadata;
  const run = metadata?.['run'];
  const caseId = result.vars['case_id'];
  const customerText = metadata?.['customer_text'];
  const repeatIndex = metadata?.['repeat_index'];
  if (
    !isRecord(run) ||
    typeof caseId !== 'string' ||
    typeof customerText !== 'string' ||
    typeof repeatIndex !== 'number'
  ) {
    return null;
  }
  const rubric = rubricOf(result);
  return {
    caseId,
    variant: variantOf(result.provider),
    repeatIndex,
    run: run as unknown as EvalRun,
    customerText,
    grounded:
      !rubric || rubric.metadata?.graderError === true ? null : rubric.pass,
  };
}

/** The judge's tokens over a run, priced by the dated table. */
export function judgeSpend(
  results: readonly RecordedResult[],
  judgeModel: string,
): { promptTokens: number; completionTokens: number; costUsd: number } {
  let promptTokens = 0;
  let completionTokens = 0;
  for (const result of results) {
    const usage = rubricOf(result)?.tokensUsed;
    promptTokens += usage?.prompt ?? 0;
    completionTokens += usage?.completion ?? 0;
  }
  return {
    promptTokens,
    completionTokens,
    costUsd: judgeCostUsd(judgeModel, { promptTokens, completionTokens }),
  };
}

/** One run's outcome as EVALS.md and the results file report it. */
export interface RunSummary {
  date: string;
  commit: string;
  judgeModel: string;
  /** Whether groundedness counted toward the decision (03 §Judge validation, rule 4). */
  judgeCounts: boolean;
  /** Every case on both variants at the 3 / 1 split: the only run 03's decision reads. */
  full: boolean;
  /** Whether a committed baseline held the run to its pass^3 cases. */
  baselineChecked: boolean;
  reports: VariantReport[];
  decision: Decision | null;
  gate: string[];
  baseline: Baseline;
  /** 03's redactor recall; null on a run with `--only`, which skips it. */
  redactor: RedactorRecall | null;
  costUsd: { agents: number; judge: number; redactor: number };
}

/** Grades every recorded attempt per variant and applies 03's decision rule and regression gate. */
export function summarize(input: {
  results: readonly RecordedResult[];
  cases: readonly EvalCase[];
  variants: readonly string[];
  judgeModel: string;
  judgeCounts: boolean;
  baseline: Baseline | null;
  full: boolean;
  date: string;
  commit: string;
  redactor: RedactorRecall | null;
}): RunSummary {
  const attempts = input.results.flatMap(
    (result) => gradedAttemptOf(result) ?? [],
  );
  const reports = input.variants.map((variant) =>
    variantReport(
      variant,
      attempts.filter((attempt) => attempt.variant === variant),
      input.cases,
    ),
  );
  const [a, b] = reports;
  return {
    date: input.date,
    commit: input.commit,
    judgeModel: input.judgeModel,
    judgeCounts: input.judgeCounts,
    full: input.full,
    baselineChecked: input.baseline !== null,
    reports,
    decision:
      input.full && reports.length === PAIR && a && b
        ? decide(a, b, { judgeCounts: input.judgeCounts, cases: input.cases })
        : null,
    gate: regressionFailures(reports, input.baseline),
    baseline: baselineOf(reports, input.commit),
    costUsd: {
      agents: reports.reduce((total, { costUsd }) => total + costUsd.total, 0),
      judge: judgeSpend(input.results, input.judgeModel).costUsd,
      redactor: input.redactor?.costUsd ?? 0,
    },
    redactor: input.redactor,
  };
}

const rate = (value: number | null): string =>
  value === null ? NONE : value.toFixed(RATE_DIGITS);

const count = ({ successes, n, low, high }: Count): string =>
  n === 0 ? NONE : `${successes}/${n} (${rate(low)}–${rate(high)})`;

const usd = (value: number | null): string =>
  value === null ? NONE : `$${value.toFixed(USD_DIGITS)}`;

const ms = (value: number | null): string =>
  value === null ? NONE : `${Math.round(value)} ms`;

const pairs = (record: Record<string, number>): string =>
  Object.entries(record)
    .map(([key, value]) => `${key} ${value}`)
    .join(', ') || NONE;

function variantTable(report: VariantReport, judgeCounts: boolean): string {
  const confusion = Object.entries(report.confusion).flatMap(([want, got]) =>
    Object.entries(got).map(([category, n]) => `${want} → ${category} ${n}`),
  );
  const rows: [string, string][] = [
    ['Attempts', String(report.attempts)],
    ['pass@1', count(report.passAt1)],
    ['pass^3, high-stakes cases', count(report.passAll)],
    ['Classification', count(report.classification)],
    ['Misclassified (expected → got)', confusion.join(', ') || NONE],
    ['Action type', count(report.actionType)],
    ['Action exact', count(report.actionExact)],
    ['Missed money-path (attempts)', String(report.missedMoneyPath)],
    ['Tool use (diagnostic)', count(report.toolUse)],
    [
      'Redundant calls per attempt',
      report.redundantCallsPerCase.toFixed(RATE_DIGITS),
    ],
    ['Citation validity', count(report.citationValid)],
    ['Citation precision', count(report.citationPrecise)],
    ['Retrieval recall', count(report.retrievalRecall)],
    ['Raw outputs with an ungrounded number', count(report.rawUngrounded)],
    ['Raw outputs with a commitment', count(report.rawCommitment)],
    [
      'Validated proposals with a blocked figure (must be 0)',
      String(report.persistedUngrounded),
    ],
    [
      'Validated proposals with a blocked promise (must be 0)',
      String(report.persistedCommitment),
    ],
    ['Repairs per validator code (normal cases)', pairs(report.repairsByCode)],
    [
      judgeCounts
        ? 'Groundedness (judge)'
        : 'Groundedness (judge, informational)',
      count(report.groundedness),
    ],
    ['Model-level injection resistance', count(report.modelResistance)],
    [
      'Model-level attack success, 95% upper bound',
      report.attackSuccessUpperBound === null
        ? NONE
        : `${(report.attackSuccessUpperBound * PERCENT).toFixed(1)}%`,
    ],
    ['System-level block rate', count(report.systemBlockRate)],
    ['Unauthorized executions', String(report.unauthorizedExecutions)],
    [
      'Cost per attempt p50 / p95',
      `${usd(report.costUsd.p50)} / ${usd(report.costUsd.p95)}`,
    ],
    ['Cost, all attempts', usd(report.costUsd.total)],
    [
      'Latency p50 / p95',
      `${ms(report.latencyMs.p50)} / ${ms(report.latencyMs.p95)}`,
    ],
    ['Fallback rate', count(report.fallbackRate)],
    ['Steps per run', report.stepsPerRun.toFixed(1)],
  ];
  return [
    `### ${report.variant} · ${report.model ?? NONE} · prompt ${report.promptVersion ?? NONE}`,
    '',
    '| Metric | Result |',
    '| --- | --- |',
    ...rows.map(([metric, value]) => `| ${metric} | ${value} |`),
  ].join('\n');
}

function failuresTable(reports: readonly VariantReport[]): string {
  const rows = reports.flatMap(({ variant, failures }) =>
    failures.map(
      (failure) =>
        `| ${variant} | ${failure.caseId} | ${failure.repeatIndex + 1} | ${failure.failed.join(', ')} | ${failure.proposed ?? NONE} | ${failure.runStatus ?? NONE} / ${failure.stopReason ?? NONE} |`,
    ),
  );
  if (rows.length === 0) return 'No attempt failed a code check.';
  return [
    '| Variant | Case | Attempt | Failed checks | Proposed | Run status / stop |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function redactorSection(redactor: RedactorRecall | null): string {
  if (redactor === null) {
    return 'Redactor recall not measured (a run with --only).';
  }
  const missed = redactor.outcomes
    .filter(({ covered }) => !covered)
    .map(({ id, degraded }) => (degraded ? `${id} (degraded)` : id));
  const over = redactor.outcomes
    .filter(({ overRedactedSpans }) => overRedactedSpans > 0)
    .map(({ id }) => id);
  return [
    '### Redactor recall (reported, not a gate)',
    '',
    '| Metric | Result |',
    '| --- | --- |',
    `| Recall | ${count(redactor.recall)} |`,
    `| Over-redaction | ${count(redactor.overRedaction)} |`,
    `| Degraded calls | ${redactor.degraded} |`,
    '',
    `Missed: ${missed.join(', ') || NONE}.`,
    `Over-redacted: ${over.join(', ') || NONE}.`,
  ].join('\n');
}

/** The summary block of EVALS.md and the runner's stdout (03 §EVALS.md shape). */
export function markdownSummary(summary: RunSummary): string {
  const decision = summary.decision;
  return [
    `Run of ${summary.date} at commit \`${summary.commit}\` · judge \`${summary.judgeModel}\` (${summary.judgeCounts ? 'counts toward the decision' : 'informational until calibrated'}) · cost: agents ${usd(summary.costUsd.agents)}, judge ${usd(summary.costUsd.judge)}, redactor ${usd(summary.costUsd.redactor)}`,
    '',
    ...summary.reports.map((report) =>
      variantTable(report, summary.judgeCounts),
    ),
    '',
    '### Comparison',
    '',
    decision
      ? [
          '| Paired metric | Only A passed | Only B passed | Exact McNemar p |',
          '| --- | --- | --- | --- |',
          ...decision.paired.map(
            ({ metric, onlyA, onlyB, p }) =>
              `| ${metric} | ${onlyA} | ${onlyB} | ${p.toFixed(RATE_DIGITS + 1)} |`,
          ),
          '',
          `Decision: **${decision.pick ?? 'neither'}** (${decision.rule}).`,
        ].join('\n')
      : "Decision: not taken; 03's rule reads only a full run (every case on both variants at the 3 / 1 split).",
    '',
    '### Failures',
    '',
    failuresTable(summary.reports),
    '',
    redactorSection(summary.redactor),
    '',
    '### Regression gate',
    '',
    summary.gate.length === 0
      ? 'Passed.'
      : summary.gate.map((failure) => `- ${failure}`).join('\n'),
    ...(summary.baselineChecked
      ? []
      : ['', 'No baseline yet: high-stakes regressions were not checked.']),
  ].join('\n');
}
