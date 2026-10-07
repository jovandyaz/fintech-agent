export interface LoopSteps {
  /** Claims and executes one action; false when none is waiting. */
  drainOne: () => Promise<boolean>;
  sweep: () => Promise<void>;
  sleep: () => Promise<void>;
  signal: AbortSignal;
  onError?: (error: unknown) => void;
}

/**
 * The executor's cycle: drain every waiting action, sweep stale executions,
 * wait, repeat until aborted. A failed cycle is reported and the next one
 * runs, so a database blip never stops the outbox.
 */
export async function runLoop(steps: LoopSteps): Promise<void> {
  while (!steps.signal.aborted) {
    try {
      let waiting = true;
      while (waiting && !steps.signal.aborted) {
        waiting = await steps.drainOne();
      }
      if (!steps.signal.aborted) await steps.sweep();
    } catch (error) {
      steps.onError?.(error);
    }
    if (!steps.signal.aborted) await steps.sleep();
  }
}
