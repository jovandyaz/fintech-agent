import { execFileSync } from 'node:child_process';

import type {
  EvaluateResult,
  EvaluateTestSuite,
  ResultFailureReason,
} from 'promptfoo';

const CENTS_DIGITS = 4;
const TELEMETRY_OFF = 'PROMPTFOO_DISABLE_TELEMETRY';
const PROVIDER_THREW: ResultFailureReason = 2;
// promptfoo 0.124 turns a throwing `javascript` assertion into a plain
// failed assertion with this reason; a checker bug must not read as a model
// failure.
const CHECKER_THREW = 'Custom function threw error';

/** One attempt of one case on one variant, as the summaries count it. */
export interface TrialResult {
  caseId: string;
  providerId: string;
  success: boolean;
  /** The grader could not be reached, so the trial carries no verdict. */
  errored: boolean;
  /** The provider or a checker threw: the attempt reached no verdict. */
  neverRan: boolean;
  inputTokens: number;
  outputTokens: number;
  /** Null when the provider reported no cost. */
  costUsd: number | null;
}

/** All attempts of one case on one variant. */
export interface CaseOutcome {
  caseId: string;
  providerId: string;
  trials: number;
  passes: number;
  graderErrors: number;
  unrunAttempts: number;
  /** pass^k: every attempt passed, graded and answered (03 §Repeats). */
  passAll: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

type PromptfooTrial = Pick<
  EvaluateResult,
  'success' | 'vars' | 'gradingResult' | 'provider' | 'cost'
> &
  Partial<Pick<EvaluateResult, 'failureReason'>> & {
    tokenUsage?: {
      prompt?: number | undefined;
      completion?: number | undefined;
    };
  };

/**
 * The summary key of a case: its id and the variant that ran it, so the
 * repeats of one case never merge with another case or the other variant.
 */
export const caseKeyOf = (caseId: string, providerId: string): string =>
  `${providerId}|${caseId}`;

/**
 * The variant a result belongs to. Variants may share one provider id and
 * differ by label, so the label wins; neither set throws, because results
 * would merge across variants.
 */
export function variantOf(provider: {
  id?: string | undefined;
  label?: string | undefined;
}): string {
  const variant = provider.label ?? provider.id;
  if (!variant) throw new Error('a result names no provider id or label');
  return variant;
}

/**
 * Reads one promptfoo result. A trial is errored only when every failing
 * assertion is a grader transport error (`metadata.graderError`); a real
 * failure beside one, or a provider throw, stays a behavioral failure.
 */
export function toTrialResult(result: PromptfooTrial): TrialResult {
  const failed = (result.gradingResult?.componentResults ?? []).filter(
    (component) => !component.pass,
  );
  const checkerThrew = failed.some((component) =>
    component.reason.startsWith(CHECKER_THREW),
  );
  const onlyGraderErrors =
    failed.length > 0 &&
    failed.every((component) => component.metadata?.graderError === true);
  const caseId = result.vars['case_id'];
  if (typeof caseId !== 'string') {
    throw new Error('every eval test carries vars.case_id');
  }
  return {
    caseId,
    providerId: variantOf(result.provider),
    success: result.success,
    errored: !result.success && onlyGraderErrors,
    neverRan: result.failureReason === PROVIDER_THREW || checkerThrew,
    inputTokens: result.tokenUsage?.prompt ?? 0,
    outputTokens: result.tokenUsage?.completion ?? 0,
    costUsd: typeof result.cost === 'number' ? result.cost : null,
  };
}

/** Groups trials by case and variant, in first-seen order. */
export function summarizeTrials(trials: readonly TrialResult[]): CaseOutcome[] {
  const byCase = new Map<string, CaseOutcome>();
  for (const result of trials) {
    const key = caseKeyOf(result.caseId, result.providerId);
    const entry = byCase.get(key) ?? {
      caseId: result.caseId,
      providerId: result.providerId,
      trials: 0,
      passes: 0,
      graderErrors: 0,
      unrunAttempts: 0,
      passAll: false,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
    const graderErrors =
      entry.graderErrors + (!result.success && result.errored ? 1 : 0);
    const unrunAttempts = entry.unrunAttempts + (result.neverRan ? 1 : 0);
    const trialsSoFar = entry.trials + 1;
    const passes = entry.passes + (result.success ? 1 : 0);
    byCase.set(key, {
      ...entry,
      trials: trialsSoFar,
      passes,
      graderErrors,
      unrunAttempts,
      passAll: passes === trialsSoFar,
      inputTokens: entry.inputTokens + result.inputTokens,
      outputTokens: entry.outputTokens + result.outputTokens,
      costUsd:
        entry.costUsd === null || result.costUsd === null
          ? null
          : entry.costUsd + result.costUsd,
    });
  }
  return [...byCase.values()];
}

/**
 * Throws naming every case and variant with an attempt that reached no
 * verdict because the provider or a checker threw: a down stack must stop
 * the run, never read as a 0% (03 §Runner).
 */
export function assertEveryAttemptRan(outcomes: readonly CaseOutcome[]): void {
  const failed = outcomes.filter(({ unrunAttempts }) => unrunAttempts > 0);
  if (failed.length === 0) return;
  const names = failed.map(
    ({ providerId, caseId, unrunAttempts }) =>
      `${providerId} ${caseId} (${unrunAttempts})`,
  );
  throw new Error(
    `attempts reached no verdict (the provider or a checker threw): ${names.join(', ')}`,
  );
}

/** One line per case and variant for the console. */
export function formatCaseOutcome(outcome: CaseOutcome): string {
  const graded = outcome.trials - outcome.graderErrors;
  const verdict = outcome.passAll ? 'PASS' : 'FAIL';
  const counts =
    outcome.graderErrors === 0
      ? `${outcome.passes}/${outcome.trials}`
      : `${outcome.passes}/${graded} graded, ${outcome.graderErrors} of ${outcome.trials} ungraded`;
  const cost =
    outcome.costUsd === null
      ? ''
      : ` · $${outcome.costUsd.toFixed(CENTS_DIGITS)}`;
  return `${verdict} ${counts} · ${outcome.inputTokens}/${outcome.outputTokens} tok${cost} · ${outcome.providerId} · ${outcome.caseId}`;
}

/** The provider key, or a throw: a run without one would grade nothing and look like a 0%. */
export function requireApiKey(env: NodeJS.ProcessEnv): string {
  const key = env['ANTHROPIC_API_KEY']?.trim();
  if (!key) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set: the eval runner calls the provider and the judge',
    );
  }
  return key;
}

/** The commit a run is attributed to. */
export const gitSha = (): string =>
  execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim();

/**
 * Runs one promptfoo `evaluate()` with the cache off: each repeat index has
 * its own cache entry, so a cached re-run would silently reuse answers (03
 * §Runner). Repeats come from each test's `options.repeat`.
 */
export async function runEvalSuite(
  suite: EvaluateTestSuite,
  options: { maxConcurrency?: number } = {},
): Promise<EvaluateResult[]> {
  // Eval rows hold case text and drafts; promptfoo's usage telemetry stays off.
  process.env[TELEMETRY_OFF] ??= 'true';
  const { default: promptfoo } = await import('promptfoo');
  const record = await promptfoo.evaluate(suite, {
    cache: false,
    maxConcurrency: options.maxConcurrency ?? 1,
    showProgressBar: false,
  });
  const summary = await record.toEvaluateSummary();
  return summary.results;
}
