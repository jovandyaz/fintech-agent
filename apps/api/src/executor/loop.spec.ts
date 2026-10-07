import { describe, expect, it } from 'vitest';

import { runLoop } from './loop.js';

describe('runLoop', () => {
  it('drains until nothing is left, sweeps, waits, and stops when aborted', async () => {
    const events: string[] = [];
    const controller = new AbortController();
    let queued = 2;
    await runLoop({
      drainOne: () => {
        events.push('drain');
        if (queued === 0) return Promise.resolve(false);
        queued -= 1;
        return Promise.resolve(true);
      },
      sweep: () => {
        events.push('sweep');
        return Promise.resolve();
      },
      sleep: () => {
        events.push('sleep');
        controller.abort();
        return Promise.resolve();
      },
      signal: controller.signal,
    });
    expect(events).toEqual(['drain', 'drain', 'drain', 'sweep', 'sleep']);
  });

  it('keeps running after a failed cycle and reports it', async () => {
    const controller = new AbortController();
    const failures: unknown[] = [];
    let cycles = 0;
    await runLoop({
      drainOne: () => {
        cycles += 1;
        if (cycles === 1) return Promise.reject(new Error('db down'));
        controller.abort();
        return Promise.resolve(false);
      },
      sweep: () => Promise.resolve(),
      sleep: () => Promise.resolve(),
      signal: controller.signal,
      onError: (error) => failures.push(error),
    });
    expect(cycles).toBe(2);
    expect(failures).toHaveLength(1);
  });
});
