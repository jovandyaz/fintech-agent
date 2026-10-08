import { describe, expect, it } from 'vitest';

import {
  cohensKappa,
  exactUpperBound,
  mcnemarExactP,
  percentile,
  wilson,
} from './stats.js';

const close = (value: number | null, expected: number, digits = 3) =>
  expect(value).toBeCloseTo(expected, digits);

describe('wilson (95% score interval)', () => {
  it('gives 03 its worked example: 21/24 → 0.69–0.96', () => {
    const interval = wilson(21, 24);
    close(interval.low, 0.69, 2);
    close(interval.high, 0.96, 2);
  });

  it('bounds zero successes in 30 attempts by about 11%, never by 0', () => {
    const interval = wilson(0, 30);
    expect(interval.low).toBe(0);
    close(interval.high, 0.1135, 4);
  });

  it('has no interval without trials', () => {
    expect(wilson(0, 0)).toEqual({ low: null, high: null });
  });
});

describe('cohensKappa (2×2, judge vs human)', () => {
  it('reports 03 example: 40 passes, 6 fails, the judge lets 1 fail through → κ ≈ 0.90', () => {
    close(
      cohensKappa({
        bothFail: 5,
        bothPass: 40,
        judgeFailHumanPass: 0,
        judgePassHumanFail: 1,
      }),
      0.9,
      2,
    );
  });

  it('has no kappa when chance agreement is total', () => {
    expect(
      cohensKappa({
        bothFail: 0,
        bothPass: 10,
        judgeFailHumanPass: 0,
        judgePassHumanFail: 0,
      }),
    ).toBeNull();
  });
});

describe('exactUpperBound (one-sided 95%, Clopper-Pearson)', () => {
  it('bounds 0 attack successes in 30 attempts at 9.5% (03)', () => {
    close(exactUpperBound(0, 30), 0.095, 3);
  });

  it('bounds 1 success in 30 attempts at about 14.9%', () => {
    close(exactUpperBound(1, 30), 0.1486, 3);
  });

  it('is 1 when every attempt succeeded, and none without attempts', () => {
    expect(exactUpperBound(5, 5)).toBe(1);
    expect(exactUpperBound(0, 0)).toBeNull();
  });
});

describe('mcnemarExactP (two-sided, discordant pairs)', () => {
  it('reaches p < 0.05 only with 6 discordants all one way (03)', () => {
    expect(mcnemarExactP(6, 0)).toBeLessThan(0.05);
    expect(mcnemarExactP(5, 0)).toBeGreaterThan(0.05);
  });

  it('is 1 with no discordant pair or a perfect split', () => {
    expect(mcnemarExactP(0, 0)).toBe(1);
    expect(mcnemarExactP(3, 3)).toBe(1);
  });

  it('matches the binomial: b = 1, c = 7 → p = 0.0703', () => {
    close(mcnemarExactP(1, 7), 0.0703, 4);
  });
});

describe('percentile (nearest rank)', () => {
  it('takes p50 and p95 by nearest rank', () => {
    const values = [5, 1, 3, 2, 4];
    expect(percentile(values, 50)).toBe(3);
    expect(percentile(values, 95)).toBe(5);
  });

  it('takes the lower middle as p50 of an even count (nearest rank)', () => {
    expect(percentile([4, 1, 3, 2], 50)).toBe(2);
  });

  it('has none for no values', () => {
    expect(percentile([], 50)).toBeNull();
  });
});
