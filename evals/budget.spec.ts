import { describe, expect, it } from 'vitest';

import { spendCap } from './budget.js';
import { fixtureOf } from './fixtures.js';
import { evalRunOf } from './test/eval-run.js';

const FIXTURE = fixtureOf('GEN-01');

describe('spendCap (the run budget the user approved)', () => {
  it('runs attempts until their cost reaches the cap, then refuses without calling the provider', async () => {
    let calls = 0;
    const cap = spendCap(0.1);
    const attempt = cap.guard(() => {
      calls += 1;
      return Promise.resolve(evalRunOf({ cost_usd: 0.06 }));
    });
    await attempt(FIXTURE);
    await attempt(FIXTURE);
    await expect(attempt(FIXTURE)).rejects.toThrow('spend cap of $0.1');
    expect(calls).toBe(2);
    expect(cap.spentUsd()).toBeCloseTo(0.12);
  });

  it('refuses the attempt after spending exactly the cap', async () => {
    const cap = spendCap(0.1);
    const attempt = cap.guard(() =>
      Promise.resolve(evalRunOf({ cost_usd: 0.05 })),
    );
    await attempt(FIXTURE);
    await attempt(FIXTURE);
    await expect(attempt(FIXTURE)).rejects.toThrow('spend cap');
  });

  it('counts nothing for an attempt that threw', async () => {
    const cap = spendCap(1);
    await expect(
      cap.guard(() => Promise.reject(new Error('stack down')))(FIXTURE),
    ).rejects.toThrow('stack down');
    expect(cap.spentUsd()).toBe(0);
  });
});
