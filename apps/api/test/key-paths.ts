/**
 * Every key path in a JSON value with its leaf type, array elements folded
 * into one `[]` segment, so two values compare by shape and not by contents
 * (a canary must read like a real case, 02 G3).
 */
export function keyPathsOf(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return value.length === 0
      ? [`${prefix}[]`]
      : value.flatMap((item) => keyPathsOf(item, `${prefix}[]`));
  }
  if (value === null) return [`${prefix}:null`];
  if (typeof value !== 'object') return [`${prefix}:${typeof value}`];
  return Object.entries(value).flatMap(([key, item]) =>
    keyPathsOf(item, `${prefix}.${key}`),
  );
}
