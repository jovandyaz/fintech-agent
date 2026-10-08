import type { EvalAttempt } from './provider.js';

/** What a run has spent on agent attempts, and the guard that stops it at its cap. */
export interface SpendCap {
  guard: (attempt: EvalAttempt) => EvalAttempt;
  spentUsd: () => number;
}

/**
 * Stops a run once its agent attempts have cost `capUsd`: every attempt
 * after that throws before it calls the provider, so promptfoo records it
 * as never ran and the run fails instead of spending on. Attempts already
 * in flight finish, so a run can pass the cap by at most its concurrency.
 */
export function spendCap(capUsd: number): SpendCap {
  let spent = 0;
  return {
    guard: (attempt) => async (fixture) => {
      if (spent >= capUsd) {
        throw new Error(
          `spend cap of $${capUsd} reached ($${spent.toFixed(4)} spent): attempt not run`,
        );
      }
      const run = await attempt(fixture);
      spent += run.cost_usd;
      return run;
    },
    spentUsd: () => spent,
  };
}
