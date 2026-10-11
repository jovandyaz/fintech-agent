import type { JudgeInput } from '@fintech-agent/api/evals';
import type { ApiProvider, Assertion, GradingResult } from 'promptfoo';

import { runEvalSuite } from '../runtime.js';
import { judgedBy, type Grader } from './groundedness.js';
import { judgeText } from './text.js';

const JUDGE_KEY = 'judge_id';
const JUDGE_CONCURRENCY = 4;

/**
 * Judges each input once through promptfoo, as an eval run judges an
 * attempt: the answer is `judgeText`, graded by the groundedness assertion
 * with `grader` behind `judgedBy`, so a null input (a run with no reply)
 * never reaches the judge. Returns each input's rubric result by its key.
 */
export async function judgeEach(
  inputs: ReadonlyMap<string, JudgeInput | null>,
  groundedness: Assertion,
  grader: Grader,
): Promise<Map<string, GradingResult>> {
  const provider: ApiProvider = {
    id: () => 'judge-each',
    callApi: (_prompt, context) => {
      const key = context?.vars[JUDGE_KEY];
      const input = typeof key === 'string' ? inputs.get(key) : undefined;
      if (input === undefined) throw new Error('a judged test names no input');
      return Promise.resolve({ output: judgeText(input) });
    },
  };
  const results = await runEvalSuite(
    {
      providers: [provider],
      prompts: [`{{${JUDGE_KEY}}}`],
      tests: [...inputs.keys()].map((key) => ({
        vars: { [JUDGE_KEY]: key },
        options: judgedBy(grader),
        assert: [groundedness],
      })),
    },
    { maxConcurrency: JUDGE_CONCURRENCY },
  );
  return new Map(
    results.map((result) => {
      const key = result.vars[JUDGE_KEY];
      const rubric = result.gradingResult?.componentResults?.[0];
      if (typeof key !== 'string' || !rubric) {
        throw new Error('a judged input came back with no verdict');
      }
      return [key, rubric];
    }),
  );
}
