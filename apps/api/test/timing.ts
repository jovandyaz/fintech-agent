const TIMED_RUNS = 3;

// The fastest of a few runs: parallel verify runs stall single samples past
// a budget, but a superlinear regression is slow on every run.
export const fastestRunMs = (work: () => unknown): number =>
  Math.min(
    ...Array.from({ length: TIMED_RUNS }, () => {
      const started = performance.now();
      work();
      return performance.now() - started;
    }),
  );
