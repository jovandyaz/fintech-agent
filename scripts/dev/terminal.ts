import { stdin, stdout } from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { styleText } from 'node:util';

import type { Check, CheckLevel } from './checks.ts';
import { EXIT, UsageError } from './config.ts';

const WARN_COLOR = 'yellow';

const MARKS = {
  pass: { label: ' ok ', color: 'green' },
  note: { label: 'note', color: WARN_COLOR },
  fail: { label: 'FAIL', color: 'red' },
} as const satisfies Record<CheckLevel, { label: string; color: string }>;
const FIX_INDENT = ' '.repeat(8);

export function heading(text: string): void {
  console.log(`\n${styleText('bold', text)}`);
}

export function warn(text: string): void {
  console.log(styleText(WARN_COLOR, text));
}

/** Prints checks with their fixes; true when none failed. */
export function printChecks(checks: readonly Check[]): boolean {
  for (const check of checks) {
    const mark = MARKS[check.level];
    console.log(`  ${styleText(mark.color, mark.label)}  ${check.text}`);
    for (const line of check.fix?.split('\n') ?? []) {
      console.log(`${FIX_INDENT}${line}`);
    }
  }
  return checks.every((check) => check.level !== 'fail');
}

/** Whether someone is at a terminal to answer a prompt; never in CI. */
export function isInteractive(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY) && !process.env.CI;
}

async function readLine(
  output: Writable,
  query: (prompt: Interface) => Promise<string>,
): Promise<string> {
  const prompt = createInterface({ input: stdin, output, terminal: true });
  // Without a listener readline only pauses on Ctrl+C and the question
  // would never settle.
  prompt.on('SIGINT', () => {
    prompt.close();
    stdout.write('\n');
    process.exit(EXIT.interrupted);
  });
  try {
    return (await query(prompt)).trim();
  } finally {
    prompt.close();
  }
}

export function ask(question: string): Promise<string> {
  return readLine(stdout, (prompt) => prompt.question(question));
}

/** Asks for a secret: what is typed or pasted is never echoed. */
export async function askHidden(question: string): Promise<string> {
  const discard = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  try {
    // The question goes out only once the interface has put the terminal in
    // raw mode, or a paste arriving first would be echoed.
    return await readLine(discard, (prompt) => {
      stdout.write(question);
      return prompt.question('');
    });
  } finally {
    stdout.write('\n');
  }
}

/**
 * Runs a command's main and sets the process exit code from it; a usage error
 * prints its message and exits 2, anything else propagates.
 */
export async function runCommand(main: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await main();
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(error.message);
    process.exitCode = EXIT.usage;
  }
}
