const STATE_INCREMENT = 0x6d_2b_79_f5;
const FIRST_SHIFT = 15;
const SECOND_SHIFT = 7;
const THIRD_SHIFT = 14;
const SECOND_MULTIPLIER_BITS = 61;
const UINT32_RANGE = 2 ** 32;

/**
 * Draws in [0, 1) that repeat for the same seed (mulberry32), so a test can
 * replay many paced runs with varied draws and still be reproducible.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + STATE_INCREMENT) >>> 0;
    let mixed = Math.imul(state ^ (state >>> FIRST_SHIFT), state | 1);
    mixed ^=
      mixed +
      Math.imul(
        mixed ^ (mixed >>> SECOND_SHIFT),
        mixed | SECOND_MULTIPLIER_BITS,
      );
    return ((mixed ^ (mixed >>> THIRD_SHIFT)) >>> 0) / UINT32_RANGE;
  };
}

/** `first`, then the draws of `seededRandom(seed)`: a test pins the first decision of a run. */
export function seededRandomAfter(first: number, seed: number): () => number {
  const rest = seededRandom(seed);
  let drawn = false;
  return () => {
    if (drawn) return rest();
    drawn = true;
    return first;
  };
}
