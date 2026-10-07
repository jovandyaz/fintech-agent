import { describe, expect, it } from 'vitest';

import type { Claim } from './queue.js';
import type { CaseEnd } from './run-case.js';
import { createBreaker, runWorker, type WorkerDeps } from './worker.js';

const UNAVAILABLE: CaseEnd = {
  kind: 'failed',
  errorCode: 'provider_unavailable',
  caseStatus: 'queued',
  providerOutage: true,
};
const TIMED_OUT: CaseEnd = { ...UNAVAILABLE, providerOutage: false };
const INTERNAL: CaseEnd = {
  kind: 'failed',
  errorCode: 'internal_error',
  caseStatus: 'queued',
  providerOutage: false,
};
const PERSISTED: CaseEnd = { kind: 'persisted', runStatus: 'succeeded' };
const MCP_DOWN: CaseEnd = {
  kind: 'failed',
  errorCode: 'mcp_unavailable',
  caseStatus: 'queued',
  providerOutage: false,
};
const STALE: CaseEnd = { kind: 'stale' };
// 01 and the 02 "Agent loop" row name these; the test restates them.
const BREAKER_FAILURES_TO_OPEN = 5;
const BREAKER_OPEN_MS = 60_000;

function clock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const failTimes = (breaker: ReturnType<typeof createBreaker>, n: number) => {
  for (let i = 0; i < n; i += 1) breaker.record(UNAVAILABLE);
};

describe('the circuit breaker (01 §Failure handling, provider outage)', () => {
  it('opens after five consecutive provider failures and stops claims for 60 s', () => {
    const time = clock();
    const breaker = createBreaker(time.now);
    failTimes(breaker, BREAKER_FAILURES_TO_OPEN - 1);
    expect(breaker.canClaim()).toBe(true);
    breaker.record(UNAVAILABLE);
    expect(breaker.canClaim()).toBe(false);
    time.advance(BREAKER_OPEN_MS - 1);
    expect(breaker.canClaim()).toBe(false);
    time.advance(1);
    expect(breaker.canClaim()).toBe(true);
  });

  it('counts only consecutive failures: a proposal resets the count', () => {
    const breaker = createBreaker(clock().now);
    failTimes(breaker, BREAKER_FAILURES_TO_OPEN - 1);
    breaker.record(PERSISTED);
    failTimes(breaker, BREAKER_FAILURES_TO_OPEN - 1);
    expect(breaker.canClaim()).toBe(true);
  });

  it.each([
    ['a stale attempt', STALE],
    ['an MCP failure', MCP_DOWN],
    ['an error of the harness', INTERNAL],
    ['a missing API key', { ...INTERNAL, errorCode: 'no_api_key' as const }],
  ])('takes %s as no evidence about the provider', (_, neutral) => {
    const breaker = createBreaker(clock().now);
    failTimes(breaker, BREAKER_FAILURES_TO_OPEN - 1);
    breaker.record(neutral);
    expect(breaker.canClaim()).toBe(true);
    breaker.record(UNAVAILABLE);
    expect(breaker.canClaim()).toBe(false);
  });

  it('does not count a timeout: only a 429, 529 or 5xx is an outage', () => {
    const breaker = createBreaker(clock().now);
    failTimes(breaker, BREAKER_FAILURES_TO_OPEN - 1);
    breaker.record(TIMED_OUT);
    failTimes(breaker, BREAKER_FAILURES_TO_OPEN - 1);
    expect(breaker.canClaim()).toBe(true);
  });

  it('half-open: one more provider failure opens it again at once', () => {
    const time = clock();
    const breaker = createBreaker(time.now);
    failTimes(breaker, BREAKER_FAILURES_TO_OPEN);
    time.advance(BREAKER_OPEN_MS);
    breaker.record(UNAVAILABLE);
    expect(breaker.canClaim()).toBe(false);
    time.advance(BREAKER_OPEN_MS);
    expect(breaker.canClaim()).toBe(true);
  });

  it('half-open: an attempt that never reached the provider leaves it half-open', () => {
    const time = clock();
    const breaker = createBreaker(time.now);
    failTimes(breaker, BREAKER_FAILURES_TO_OPEN);
    time.advance(BREAKER_OPEN_MS);
    breaker.record(MCP_DOWN);
    breaker.record(UNAVAILABLE);
    expect(breaker.canClaim()).toBe(false);
  });

  it('half-open: a case the provider answered closes it', () => {
    const time = clock();
    const breaker = createBreaker(time.now);
    failTimes(breaker, BREAKER_FAILURES_TO_OPEN);
    time.advance(BREAKER_OPEN_MS);
    breaker.record(PERSISTED);
    failTimes(breaker, BREAKER_FAILURES_TO_OPEN - 1);
    expect(breaker.canClaim()).toBe(true);
  });
});

describe('runWorker', () => {
  const claimOf = (n: number): Claim => ({
    caseId: `case_${n}`,
    claimToken: `t${n}`,
    attempt: 1,
  });

  function worker(overrides: Partial<WorkerDeps> & { cases?: number } = {}) {
    const stop = new AbortController();
    const ran: string[] = [];
    const errors: unknown[] = [];
    let claims = 0;
    let sleeps = 0;
    let waiting = overrides.cases ?? 0;
    const time = clock();
    const deps: WorkerDeps = {
      claim: () => {
        claims += 1;
        if (waiting === 0) return Promise.resolve(null);
        waiting -= 1;
        return Promise.resolve(claimOf(waiting));
      },
      run: (claim) => {
        ran.push(claim.caseId);
        return Promise.resolve(PERSISTED);
      },
      breaker: createBreaker(time.now),
      sleep: () => {
        sleeps += 1;
        if (sleeps >= 3) stop.abort();
        return Promise.resolve();
      },
      signal: stop.signal,
      onError: (error) => errors.push(error),
      ...overrides,
    };
    return {
      deps,
      ran,
      errors,
      time,
      claims: () => claims,
      sleeps: () => sleeps,
    };
  }

  it('runs every waiting case back to back, sleeping only once none waits', async () => {
    const w = worker({ cases: 3 });
    const stop = new AbortController();
    await runWorker({
      ...w.deps,
      signal: stop.signal,
      sleep: () => {
        stop.abort();
        return Promise.resolve();
      },
    });
    expect(w.ran).toEqual(['case_2', 'case_1', 'case_0']);
    expect(w.claims()).toBe(4);
  });

  it('does not sleep once stopped during a claim', async () => {
    const w = worker();
    const stop = new AbortController();
    await runWorker({
      ...w.deps,
      signal: stop.signal,
      claim: () => {
        stop.abort();
        return Promise.resolve(null);
      },
    });
    expect(w.sleeps()).toBe(0);
  });

  it('claims nothing while the breaker is open, so no attempt is consumed', async () => {
    const w = worker({ cases: 10 });
    const breaker = createBreaker(w.time.now);
    failTimes(breaker, BREAKER_FAILURES_TO_OPEN);
    await runWorker({ ...w.deps, breaker });
    expect(w.claims()).toBe(0);
    expect(w.ran).toEqual([]);
  });

  it('feeds every case end to the breaker', async () => {
    const w = worker({ cases: 10 });
    await runWorker({
      ...w.deps,
      run: (claim) => {
        w.ran.push(claim.caseId);
        return Promise.resolve(UNAVAILABLE);
      },
    });
    expect(w.ran).toHaveLength(BREAKER_FAILURES_TO_OPEN);
  });

  it('reports a failed cycle and keeps going', async () => {
    const w = worker({ cases: 2 });
    let first = true;
    await runWorker({
      ...w.deps,
      run: (claim) => {
        if (first) {
          first = false;
          return Promise.reject(new Error('database blip'));
        }
        w.ran.push(claim.caseId);
        return Promise.resolve(PERSISTED);
      },
    });
    expect(w.errors).toHaveLength(1);
    expect(w.ran).toEqual(['case_0']);
  });

  it('stops without claiming once aborted', async () => {
    const w = worker({ cases: 5 });
    const stopped = new AbortController();
    stopped.abort();
    await runWorker({ ...w.deps, signal: stopped.signal });
    expect(w.claims()).toBe(0);
  });
});
