const NORMAL_QUANTILE_95_TWO_SIDED = 1.959964;
const ALPHA_ONE_SIDED = 0.05;
const BISECTION_STEPS = 100;
const HALF = 0.5;
const PERCENT = 100;

/** A proportion's interval; null bounds when there were no trials. */
export interface Interval {
  low: number | null;
  high: number | null;
}

/** The Wilson 95% score interval of `successes` out of `n` (03: counts with intervals). */
export function wilson(successes: number, n: number): Interval {
  if (n === 0) return { low: null, high: null };
  const z = NORMAL_QUANTILE_95_TWO_SIDED;
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z / (2 * n)) ** 2);
  return {
    low: Math.max(0, (center - spread) / denominator),
    high: Math.min(1, (center + spread) / denominator),
  };
}

const logChoose = (n: number, k: number): number => {
  let total = 0;
  for (let i = 1; i <= k; i += 1) total += Math.log(n - k + i) - Math.log(i);
  return total;
};

const binomialCdf = (k: number, n: number, p: number): number => {
  if (p <= 0) return 1;
  if (p >= 1) return k >= n ? 1 : 0;
  let total = 0;
  for (let i = 0; i <= k; i += 1) {
    total += Math.exp(
      logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p),
    );
  }
  return total;
};

/**
 * The exact one-sided 95% upper bound of a rate with `successes` out of
 * `n` (Clopper-Pearson): 0 attack successes in 30 attempts → 9.5%, never
 * "0%" (03 §Metrics).
 */
export function exactUpperBound(successes: number, n: number): number | null {
  if (n === 0) return null;
  if (successes >= n) return 1;
  let low = 0;
  let high = 1;
  for (let step = 0; step < BISECTION_STEPS; step += 1) {
    const mid = (low + high) / 2;
    if (binomialCdf(successes, n, mid) > ALPHA_ONE_SIDED) low = mid;
    else high = mid;
  }
  return high;
}

/** The exact two-sided McNemar p over the discordant pairs `b` and `c` (03 §Variant comparison). */
export function mcnemarExactP(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  return Math.min(1, 2 * binomialCdf(Math.min(b, c), n, HALF));
}

/** The four cells of judge-vs-human agreement on pass / fail rows. */
export interface AgreementCells {
  bothPass: number;
  bothFail: number;
  judgePassHumanFail: number;
  judgeFailHumanPass: number;
}

/** Cohen's kappa over the four cells; null when chance agreement leaves nothing to explain. */
export function cohensKappa(cells: AgreementCells): number | null {
  const { bothPass, bothFail, judgePassHumanFail, judgeFailHumanPass } = cells;
  const n = bothPass + bothFail + judgePassHumanFail + judgeFailHumanPass;
  if (n === 0) return null;
  const observed = (bothPass + bothFail) / n;
  const judgePass = (bothPass + judgePassHumanFail) / n;
  const humanPass = (bothPass + judgeFailHumanPass) / n;
  const chance = judgePass * humanPass + (1 - judgePass) * (1 - humanPass);
  return chance === 1 ? null : (observed - chance) / (1 - chance);
}

/** The nearest-rank percentile (p50, p95 for cost and latency); null for no values. */
export function percentile(
  values: readonly number[],
  rank: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((rank / PERCENT) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? null;
}
