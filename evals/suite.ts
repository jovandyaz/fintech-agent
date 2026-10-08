import { parseArgs } from 'node:util';

import { AGENT_VARIANTS, type EvalRun } from '@fintech-agent/api/evals';
import type {
  ApiProvider,
  Assertion,
  AssertionValueFunctionContext,
  EvaluateTestSuite,
  GradingResult,
} from 'promptfoo';

import type { EvalCase } from './cases.js';
import { judgedBy, type Grader } from './judge/groundedness.js';
import { attemptFailures, checkAttempt } from './checkers.js';
import type { Variant } from './provider.js';

/** The subsets `--only` selects (03 §Runner). */
const ONLY_SETS = ['ADV', 'high-stakes'] as const;
export type OnlySet = (typeof ONLY_SETS)[number];

const BOTH = 'both';
const ADV_PREFIX = 'ADV-';
// 03 §Repeats: high-stakes cases run three times and are judged on pass^3.
const HIGH_STAKES_REPEATS = 3;
const ONE_RUN = 1;
const CODE_CHECKS = 'code_checks';
// promptfoo 0.124 forces a weight-0 assertion to pass, which would erase the
// judge's verdict; at these weights the score clears the threshold exactly
// when the code checks pass, whatever the judge says.
const CODE_CHECKS_WEIGHT = 2;
const JUDGE_WEIGHT = 1;
const PASS_ON_CODE_CHECKS =
  CODE_CHECKS_WEIGHT / (CODE_CHECKS_WEIGHT + JUDGE_WEIGHT);

/** The runner's flags, parsed. */
export interface RunFlags {
  variants: readonly Variant[];
  only: OnlySet | null;
  /** Overrides the 3 / 1 split; null keeps it. */
  repeat: number | null;
  /** Writes `evals/baseline.json` from this run. */
  writeBaseline: boolean;
}

const isVariant = (value: string): value is Variant =>
  AGENT_VARIANTS.some((variant) => variant === value);

const isOnlySet = (value: string): value is OnlySet =>
  ONLY_SETS.some((set) => set === value);

/** Parses `--variant A|B|both`, `--only ADV|high-stakes`, `--repeat N` and `--write-baseline`; throws on anything else. */
export function parseFlags(argv: readonly string[]): RunFlags {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: {
      variant: { type: 'string', default: BOTH },
      only: { type: 'string' },
      repeat: { type: 'string' },
      'write-baseline': { type: 'boolean', default: false },
    },
  });
  const variant = values.variant;
  if (variant !== BOTH && !isVariant(variant)) {
    throw new Error(`--variant takes A, B or both, not ${variant}`);
  }
  if (values.only !== undefined && !isOnlySet(values.only)) {
    throw new Error(
      `--only takes ${ONLY_SETS.join(' or ')}, not ${values.only}`,
    );
  }
  const repeat = values.repeat === undefined ? null : Number(values.repeat);
  if (repeat !== null && (!Number.isInteger(repeat) || repeat < ONE_RUN)) {
    throw new Error(
      `--repeat takes a whole number of at least 1, not ${values.repeat}`,
    );
  }
  return {
    variants: variant === BOTH ? AGENT_VARIANTS : [variant],
    only: values.only ?? null,
    repeat,
    writeBaseline: values['write-baseline'],
  };
}

/** The labeled cases a run covers. */
export function selectCases(
  cases: readonly EvalCase[],
  only: OnlySet | null,
): EvalCase[] {
  if (only === 'ADV') {
    return cases.filter(({ id }) => id.startsWith(ADV_PREFIX));
  }
  if (only === 'high-stakes') {
    return cases.filter(({ high_stakes }) => high_stakes);
  }
  return [...cases];
}

/** How many attempts a case gets: 3 high-stakes, 1 otherwise, or the `--repeat` override. */
export const repeatsOf = (label: EvalCase, repeat: number | null): number =>
  repeat ?? (label.high_stakes ? HIGH_STAKES_REPEATS : ONE_RUN);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function recordedAttempt(context: AssertionValueFunctionContext): {
  run: EvalRun;
  customerText: string;
} {
  const metadata: Record<string, unknown> | undefined = context.metadata;
  const run = metadata?.['run'];
  const customerText = metadata?.['customer_text'];
  if (
    !isRecord(run) ||
    typeof run['case_id'] !== 'string' ||
    typeof customerText !== 'string'
  ) {
    throw new Error('the provider recorded no eval run to grade');
  }
  return { run: run as unknown as EvalRun, customerText };
}

// A missing record throws, so the attempt reads as never ran, not as a
// failure of the code checks.
function codeChecks(label: EvalCase): Assertion {
  return {
    type: 'javascript',
    metric: CODE_CHECKS,
    value: (_output, context): GradingResult => {
      const { run, customerText } = recordedAttempt(context);
      const failed = attemptFailures(
        checkAttempt({ label, run, customerText }),
        label,
      );
      return {
        pass: failed.length === 0,
        score: failed.length === 0 ? 1 : 0,
        reason:
          failed.length === 0
            ? 'every code check passed'
            : `failed: ${failed.join(', ')}`,
      };
    },
  };
}

/**
 * The promptfoo suite of one run: one test per case, repeated as
 * `repeatsOf` says, passed by the code checks alone while `groundedness`
 * records the judge's verdict beside them; the report weighs that verdict
 * only once the judge is calibrated (03 §Judge validation).
 */
export function evalSuite(input: {
  cases: readonly EvalCase[];
  providers: readonly ApiProvider[];
  repeat: number | null;
  groundedness: Assertion;
  grader: Grader;
}): EvaluateTestSuite {
  return {
    description: 'Case Copilot evals (specs/03-evals.md)',
    providers: [...input.providers],
    prompts: ['{{case_id}}'],
    tests: input.cases.map((label) => ({
      description: label.id,
      vars: { case_id: label.id },
      threshold: PASS_ON_CODE_CHECKS,
      options: {
        repeat: repeatsOf(label, input.repeat),
        ...judgedBy(input.grader),
      },
      assert: [
        { ...codeChecks(label), weight: CODE_CHECKS_WEIGHT },
        { ...input.groundedness, weight: JUDGE_WEIGHT },
      ],
    })),
  };
}
