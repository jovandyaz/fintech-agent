import { variantOf } from '../runtime.js';
import {
  JudgeInputSchema,
  type CalibrationRow,
  type JudgeVerdict,
} from './rows.js';

const RUBRIC = 'llm-rubric';
const FIRST_ATTEMPT = 0;

/** The part of a promptfoo result the extraction reads; the provider sets the metadata. */
export interface GradedResult {
  vars: Record<string, unknown>;
  provider: { id?: string | undefined; label?: string | undefined };
  response?:
    | {
        metadata?: Record<string, unknown> | undefined;
      }
    | undefined;
  gradingResult?:
    | {
        componentResults?:
          | readonly {
              pass: boolean;
              reason: string;
              assertion?: { type?: string | undefined } | null | undefined;
              metadata?: { graderError?: boolean | undefined } | undefined;
            }[]
          | null
          | undefined;
      }
    | null
    | undefined;
}

/**
 * The calibration rows of a run (03 step 3): the first attempt of each case
 * and variant that the judge graded, as rows and, apart, the judge's
 * verdicts. A rubric the grader never reached (`graderError`) is no verdict,
 * so its row is left out and counted.
 */
export function extractJudgments(results: readonly GradedResult[]): {
  rows: CalibrationRow[];
  verdicts: JudgeVerdict[];
  ungraded: number;
} {
  const rows: CalibrationRow[] = [];
  const verdicts: JudgeVerdict[] = [];
  let ungraded = 0;
  for (const result of results) {
    const metadata = result.response?.metadata;
    if (metadata?.['repeat_index'] !== FIRST_ATTEMPT) continue;
    const rubric = result.gradingResult?.componentResults?.find(
      (component) => component.assertion?.type === RUBRIC,
    );
    if (!rubric) continue;
    if (rubric.metadata?.graderError === true) {
      ungraded += 1;
      continue;
    }
    const case_id = result.vars['case_id'];
    if (typeof case_id !== 'string') {
      throw new Error('every eval test carries vars.case_id');
    }
    const variant = variantOf(result.provider);
    const row_id = `${variant}:${case_id}`;
    const judgeInput = JudgeInputSchema.safeParse(metadata['judge_input']);
    if (!judgeInput.success) {
      throw new Error(`${row_id} recorded no judge input the judge can read`);
    }
    rows.push({
      row_id,
      case_id,
      variant,
      source: 'run',
      judge_input: judgeInput.data,
    });
    verdicts.push({
      row_id,
      judge_pass: rubric.pass,
      judge_reason: rubric.reason,
    });
  }
  return { rows, verdicts, ungraded };
}
