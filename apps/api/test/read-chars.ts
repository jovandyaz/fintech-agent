const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * How many characters a model reads of a tool output as `run_steps` stores it:
 * the text parts of an MCP result, which the SDK sends alone, or the output as
 * JSON, as `search_policies` returns it.
 */
export function storedReadChars(output: unknown): number {
  if (isObject(output) && Array.isArray(output.content)) {
    return output.content.reduce<number>(
      (chars, part) =>
        chars +
        (isObject(part) && typeof part.text === 'string'
          ? part.text.length
          : 0),
      0,
    );
  }
  return JSON.stringify(output).length;
}
