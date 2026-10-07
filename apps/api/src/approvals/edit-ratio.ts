/**
 * Levenshtein distance from the draft to the final reply over code points,
 * divided by the longer length: 0 is unchanged, 1 is a full rewrite. Two rows
 * of memory, O(n·m) time; contracts caps the draft and the final reply at
 * MAX_REPLY_CHARS.
 */
export function editRatio(draft: string, final: string): number {
  const from = [...draft];
  const to = [...final];
  const longest = Math.max(from.length, to.length);
  if (longest === 0) return 0;
  let previous = Array.from({ length: to.length + 1 }, (_, j) => j);
  for (let i = 1; i <= from.length; i++) {
    const current = [i];
    for (let j = 1; j <= to.length; j++) {
      const substitution =
        (previous[j - 1] ?? 0) + (from[i - 1] === to[j - 1] ? 0 : 1);
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        substitution,
      );
    }
    previous = current;
  }
  return (previous[to.length] ?? 0) / longest;
}
