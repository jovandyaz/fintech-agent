/** One item of a non-empty list, drawn with `random` in [0, 1); throws on an empty one. */
export function drawOne<T>(items: readonly T[], random: () => number): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('nothing to draw from');
  return item;
}
