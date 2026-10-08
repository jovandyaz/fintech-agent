import type { AGENT_VARIANTS, EvalRun } from '@fintech-agent/api/evals';
import { maskPii } from '@fintech-agent/contracts';
import type {
  ApiProvider,
  CallApiContextParams,
  ProviderResponse,
} from 'promptfoo';

import { fixtureOf, type CaseFixture } from './fixtures.js';
import { judgeText } from './judge/text.js';

/** One attempt of a case through the real harness. */
export type EvalAttempt = (fixture: CaseFixture) => Promise<EvalRun>;

/** A Sonnet-class model (A) against a Haiku-class one (B), 03 §Variant comparison. */
export type Variant = (typeof AGENT_VARIANTS)[number];

const FIRST_ATTEMPT = 0;
const GRADED_STATUSES: readonly (EvalRun['run_status'] & string)[] = [
  'succeeded',
  'fallback',
];

/** The promptfoo label of a variant: results are keyed by it, so it must differ per variant. */
export const variantLabel = (variant: Variant): string => `variant-${variant}`;

/**
 * The promptfoo provider of one variant (03 §Runner): each call runs one
 * attempt of the case named by `vars.case_id` and answers with what the
 * judge reads, the cost and tokens, and the whole attempt as metadata for
 * the checkers. An attempt that throws, or a run that ended without an
 * answer (no key, provider outage, MCP down), throws with its error code,
 * so promptfoo records an error instead of grading an empty answer.
 */
export function evalProvider(input: {
  variant: Variant;
  attempt: EvalAttempt;
}): ApiProvider & { label: string } {
  const label = variantLabel(input.variant);
  return {
    id: () => label,
    label,
    callApi: async (
      _prompt: string,
      context?: CallApiContextParams,
    ): Promise<ProviderResponse> => {
      const caseId = context?.vars['case_id'];
      if (typeof caseId !== 'string') {
        throw new Error('every eval test carries vars.case_id');
      }
      const fixture = fixtureOf(caseId);
      const run = await input.attempt(fixture);
      if (!GRADED_STATUSES.some((status) => status === run.run_status)) {
        throw new Error(
          `${caseId} ended ${String(run.run_status)}: ${String(run.error_code)}`,
        );
      }
      return {
        output: judgeText(run.judge_input),
        cost: run.cost_usd,
        tokenUsage: {
          prompt: run.input_tokens,
          completion: run.output_tokens,
          total: run.input_tokens + run.output_tokens,
        },
        metadata: {
          run,
          repeat_index: context?.repeatIndex ?? FIRST_ATTEMPT,
          judge_input: run.judge_input,
          customer_text: maskPii(fixture.text),
          model: run.model,
          prompt_version: run.prompt_version,
        },
      };
    },
  };
}
