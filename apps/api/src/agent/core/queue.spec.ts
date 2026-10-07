import { describe, expect, it } from 'vitest';

import { backoffMs } from './queue.js';

const LOWEST = () => 0;
const MIDDLE = () => 0.5;
const HIGHEST = () => 1;

describe('backoffMs (01 §Webhook and queue)', () => {
  it('doubles from 20 s after the first attempt', () => {
    expect(backoffMs(1, MIDDLE)).toBe(20_000);
    expect(backoffMs(2, MIDDLE)).toBe(40_000);
    expect(backoffMs(3, MIDDLE)).toBe(80_000);
  });

  it('never waits more than 5 minutes', () => {
    expect(backoffMs(10, MIDDLE)).toBe(300_000);
  });

  it('jitters by up to 20 % either way', () => {
    expect(backoffMs(1, LOWEST)).toBe(16_000);
    expect(backoffMs(1, HIGHEST)).toBe(24_000);
    expect(backoffMs(10, HIGHEST)).toBe(360_000);
  });
});
