import { describe, expect, it } from 'vitest';

import { MAX_DRAINS_PER_CYCLE, runLoop } from './loop.js';

describe('runLoop', () => {
  it('beats, sweeps, drains until nothing is left, waits, and stops when aborted', async () => {
    const events: string[] = [];
    const controller = new AbortController();
    let queued = 2;
    await runLoop({
      heartbeat: () => events.push('beat'),
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
    expect(events).toEqual([
      'beat',
      'sweep',
      'drain',
      'drain',
      'drain',
      'sleep',
    ]);
  });

  it('bounds the drains of one cycle, so a steady inflow cannot starve the sweep', async () => {
    const controller = new AbortController();
    let drains = 0;
    let sweeps = 0;
    await runLoop({
      drainOne: () => {
        drains += 1;
        return Promise.resolve(true);
      },
      sweep: () => {
        sweeps += 1;
        if (sweeps === 2) controller.abort();
        return Promise.resolve();
      },
      sleep: () => Promise.resolve(),
      signal: controller.signal,
    });
    expect(drains).toBe(MAX_DRAINS_PER_CYCLE);
    expect(sweeps).toBe(2);
  });

  it('keeps running after a failed cycle and reports it', async () => {
    const controller = new AbortController();
    const failures: unknown[] = [];
    let cycles = 0;
    await runLoop({
      drainOne: () => Promise.resolve(false),
      sweep: () => {
        cycles += 1;
        if (cycles === 1) return Promise.reject(new Error('db down'));
        controller.abort();
        return Promise.resolve();
      },
      sleep: () => Promise.resolve(),
      signal: controller.signal,
      onError: (error) => failures.push(error),
    });
    expect(cycles).toBe(2);
    expect(failures).toHaveLength(1);
  });
});
