/** Actions one cycle executes before it yields to the next sweep. */
export const MAX_DRAINS_PER_CYCLE = 50;

export interface LoopSteps {
  /** Claims and executes one action; false when none is waiting. */
  drainOne: () => Promise<boolean>;
  sweep: () => Promise<void>;
  sleep: () => Promise<void>;
  signal: AbortSignal;
  /** Called at the start of every cycle, for a liveness check. */
  heartbeat?: () => void;
  onError?: (error: unknown) => void;
}

/**
 * The executor's cycle: beat, sweep stale executions, drain waiting actions
 * up to a bound, wait, repeat until aborted. A failed cycle is reported and
 * the next one runs, so a database blip never stops the outbox.
 */
export async function runLoop(steps: LoopSteps): Promise<void> {
  while (!steps.signal.aborted) {
    steps.heartbeat?.();
    try {
      await steps.sweep();
      let drained = 0;
      while (
        drained < MAX_DRAINS_PER_CYCLE &&
        !steps.signal.aborted &&
        (await steps.drainOne())
      ) {
        drained += 1;
      }
    } catch (error) {
      steps.onError?.(error);
    }
    if (!steps.signal.aborted) await steps.sleep();
  }
}
