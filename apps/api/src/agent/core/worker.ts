import {
  INTERNAL_ERROR,
  MCP_UNAVAILABLE,
  type RunErrorCode,
} from './persist.js';
import { PROVIDER_ERROR } from './provider-errors.js';
import type { Claim } from './queue.js';
import type { CaseEnd } from './run-case.js';

const BREAKER_FAILURES_TO_OPEN = 5;
const BREAKER_OPEN_MS = 60_000;
const STALE = 'stale' satisfies CaseEnd['kind'];
const FAILED = 'failed' satisfies CaseEnd['kind'];

/** Whether the worker may claim now, fed with every attempt's end. */
export interface Breaker {
  canClaim(): boolean;
  record(end: CaseEnd): void;
}

// These attempts end before any model call, so they prove nothing either way.
const NEVER_REACHED_PROVIDER: ReadonlySet<RunErrorCode> = new Set([
  MCP_UNAVAILABLE,
  INTERNAL_ERROR,
  PROVIDER_ERROR.noApiKey,
]);

const isOutage = (end: CaseEnd): boolean =>
  end.kind === FAILED && end.providerOutage;
const saysNothing = (end: CaseEnd): boolean =>
  end.kind === STALE ||
  (end.kind === FAILED && NEVER_REACHED_PROVIDER.has(end.errorCode));

/**
 * The provider-outage breaker (01 §Failure handling): five consecutive
 * attempts that ended on a 429, 529 or 5xx open it for 60 s, so an outage does not
 * spend every case's attempts. Once the 60 s pass it is half-open: the
 * worker runs one case at a time, so the next attempt is the trial, and as
 * the count only resets on an end the provider answered, one more outage opens it again at
 * once. An attempt that never reached the provider (stale, MCP down, no
 * key, a harness error) leaves both the count and the state as they were.
 */
export function createBreaker(clock: () => number): Breaker {
  let failures = 0;
  let openUntil: number | null = null;
  return {
    canClaim: () => openUntil === null || clock() >= openUntil,
    record: (end) => {
      if (saysNothing(end)) return;
      if (!isOutage(end)) {
        failures = 0;
        openUntil = null;
        return;
      }
      failures += 1;
      if (failures >= BREAKER_FAILURES_TO_OPEN) {
        openUntil = clock() + BREAKER_OPEN_MS;
      }
    },
  };
}

export interface WorkerDeps {
  /** The next due case (`claimNextCase`), or null when none is waiting. */
  claim: () => Promise<Claim | null>;
  run: (claim: Claim) => Promise<CaseEnd>;
  breaker: Breaker;
  /** Resolves when the wait ends or `signal` aborts; it never rejects. */
  sleep: () => Promise<void>;
  signal: AbortSignal;
  /** Gets the raw error, which may carry row values: mask before logging (02 G6). */
  onError: (error: unknown) => void;
}

/**
 * The agent worker (01 §Webhook and queue): claims and runs due cases one
 * at a time until none waits, then sleeps; claims nothing while the breaker
 * is open. A failed cycle is reported and the next one runs, so a database
 * blip never stops the queue; a lost attempt is reclaimed when its lease ends.
 */
export async function runWorker(deps: WorkerDeps): Promise<void> {
  while (!deps.signal.aborted) {
    let ran = false;
    try {
      if (deps.breaker.canClaim()) {
        const claim = await deps.claim();
        if (claim) {
          deps.breaker.record(await deps.run(claim));
          ran = true;
        }
      }
    } catch (error) {
      deps.onError(error);
    }
    if (!ran && !deps.signal.aborted) await deps.sleep();
  }
}
