import { constants, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, parseEnv, type ParseArgsOptionsConfig } from 'node:util';

import type { SubnetPlan } from './checks.ts';

export type Env = Readonly<Record<string, string | undefined>>;

export const EXIT = { ok: 0, failed: 1, usage: 2, interrupted: 130 } as const;

/** A command line the script cannot act on; its message says what to fix. */
export class UsageError extends Error {
  override name = 'UsageError';
}

const OPTION_TERMINATOR = '--';

function parseFlags<T extends ParseArgsOptionsConfig>(
  argv: readonly string[],
  options: T,
  command: string,
): Record<keyof T, boolean> {
  // pnpm forwards the `--` of `pnpm start -- --help` verbatim, and parseArgs
  // would read every flag after it as a positional.
  const args = argv.filter((arg) => arg !== OPTION_TERMINATOR);
  let values: Record<string, unknown>;
  try {
    ({ values } = parseArgs({
      args,
      options,
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const [firstSentence] = reason.split('. ');
    throw new UsageError(
      `${firstSentence}. See the options: ${command} -- --help`,
    );
  }
  return Object.fromEntries(
    Object.keys(options).map((name) => [name, values[name] === true]),
  ) as Record<keyof T, boolean>;
}

const HELP = { help: { type: 'boolean', short: 'h' } } as const;

export interface StartArgs {
  agentOff: boolean;
  demo: boolean;
  check: boolean;
  help: boolean;
}

/** Reads `pnpm start` flags; throws a UsageError on anything else. */
export function parseStartArgs(argv: readonly string[]): StartArgs {
  const flags = parseFlags(
    argv,
    {
      'agent-off': { type: 'boolean' },
      'no-demo': { type: 'boolean' },
      check: { type: 'boolean' },
      ...HELP,
    },
    'pnpm start',
  );
  return {
    agentOff: flags['agent-off'],
    demo: !flags['no-demo'],
    check: flags.check,
    help: flags.help,
  };
}

export interface ResetArgs {
  yes: boolean;
  help: boolean;
}

/** Reads `pnpm reset` flags; throws a UsageError on anything else. */
export function parseResetArgs(argv: readonly string[]): ResetArgs {
  return parseFlags(
    argv,
    { yes: { type: 'boolean', short: 'y' }, ...HELP },
    'pnpm reset',
  );
}

export function parseHelpArgs(
  argv: readonly string[],
  command: string,
): { help: boolean } {
  return parseFlags(argv, HELP, command);
}

/**
 * The values compose interpolates the stack with: `.env` over the dev defaults
 * in `.env.example`, and any shell variable that is set, even to an empty
 * string, over both.
 */
export function effectiveEnv(
  example: string,
  dotEnv: string | undefined,
  shell: Env,
): Record<string, string> {
  const layers = [parseEnv(example), parseEnv(dotEnv ?? ''), shell];
  return Object.fromEntries(
    layers.flatMap((layer) =>
      Object.entries(layer).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  );
}

const TRUTHY = ['1', 'true'] as const;

/** Whether COMPOSE_DISABLE_ENV_FILE tells compose to skip `.env`. */
export function envFileDisabled(shell: Env): boolean {
  const value = shell.COMPOSE_DISABLE_ENV_FILE?.trim().toLowerCase() ?? '';
  return (TRUTHY as readonly string[]).includes(value);
}

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const LINE_BREAK = /[\r\n]/;

/**
 * The dotenv text with every assignment of `name` set to `value`, or one
 * appended when there is none. Comments and other lines stay as they are.
 */
export function withEnvValue(
  text: string,
  name: string,
  value: string,
): string {
  if (!ENV_NAME.test(name)) throw new Error(`not a variable name: ${name}`);
  if (LINE_BREAK.test(value)) throw new Error(`${name} must be one line`);
  const line = `${name}=${value}`;
  const assignment = new RegExp(
    `^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[^\\r\\n]*`,
    'gm',
  );
  // A replacer function, or `$&` and `$1` in the value would be expanded.
  if (assignment.test(text)) return text.replace(assignment, () => line);
  const separator = text === '' || text.endsWith('\n') ? '' : '\n';
  return `${text}${separator}${line}\n`;
}

// The key is written unquoted into .env, where a quote, a space or a # would
// change what compose reads.
const ANTHROPIC_KEY = /^sk-ant-[A-Za-z0-9_-]+$/;

export function isAnthropicKey(value: string): boolean {
  return ANTHROPIC_KEY.test(value);
}

export interface Operator {
  id: string;
  token: string;
}

const ENTRY_SEPARATOR = ',';
const FIELD_SEPARATOR = ':';
const OPERATOR_FIELDS = 3;

/**
 * The operators of an OPERATOR_TOKENS value. Entries the API would refuse are
 * skipped, not reported: the API names them when it boots.
 */
export function operatorsOf(tokens: string | undefined): Operator[] {
  return (tokens ?? '').split(ENTRY_SEPARATOR).flatMap((entry) => {
    const fields = entry.trim().split(FIELD_SEPARATOR);
    const [id = '', , token = ''] = fields;
    return fields.length === OPERATOR_FIELDS && id && token
      ? [{ id, token }]
      : [];
  });
}

/**
 * The operators whose tokens may be printed: only the dev tokens of
 * `.env.example`; tokens someone set are theirs to keep.
 */
export function devOperators(
  effective: string | undefined,
  example: string | undefined,
): Operator[] {
  return effective !== undefined && effective === example
    ? operatorsOf(effective)
    : [];
}

export type KeyPlan = 'use-key' | 'ask' | 'kill-switch';

/**
 * Whether to run the agent with the key it has, ask for one, or start with the
 * kill switch. It asks only on a terminal, and only when compose would read
 * the `.env` the key goes into.
 */
export function keyPlan(input: {
  agentOff: boolean;
  hasKey: boolean;
  interactive: boolean;
  envFileUsable: boolean;
}): KeyPlan {
  if (input.agentOff) return 'kill-switch';
  if (input.hasKey) return 'use-key';
  return input.interactive && input.envFileUsable ? 'ask' : 'kill-switch';
}

export const E2E_PROJECT = 'fintech-e2e';

/**
 * The environment of the throwaway e2e stack: its own project, no `.env` (so
 * no key and none of the user's overrides), the kill switch on, and its own
 * subnet once one is chosen.
 */
export function isolatedEnv(
  shell: Env,
  plan: SubnetPlan | undefined,
): Record<string, string | undefined> {
  const rest: Record<string, string | undefined> = { ...shell };
  delete rest.ANTHROPIC_API_KEY;
  return {
    ...rest,
    COMPOSE_PROJECT_NAME: E2E_PROJECT,
    COMPOSE_DISABLE_ENV_FILE: '1',
    AGENT_MODE: 'off',
    ...(plan && {
      COMPOSE_SUBNET: plan.subnet,
      COMPOSE_IP_RANGE: plan.ipRange,
      CONSOLE_IP: plan.consoleIp,
    }),
  };
}

/**
 * How `pnpm e2e:isolated` exits: Ctrl+C first, then a test failure; a failed
 * cleanup turns passing tests into a failure, since the user's stack may be
 * left stopped or the throwaway one left behind.
 */
export function e2eExit(outcome: {
  testsExit: number;
  interrupted: boolean;
  cleanupFailed: boolean;
}): number {
  if (outcome.interrupted) return EXIT.interrupted;
  if (outcome.testsExit !== EXIT.ok) return outcome.testsExit;
  return outcome.cleanupFailed ? EXIT.failed : EXIT.ok;
}

export type DotEnvState = 'created' | 'exists';

const FILE_EXISTS = 'EEXIST';

/** Copies `.env.example` to `.env` unless `.env` already exists; never overwrites. */
export function ensureDotEnv(root: string): DotEnvState {
  try {
    copyFileSync(
      join(root, '.env.example'),
      join(root, '.env'),
      constants.COPYFILE_EXCL,
    );
    return 'created';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === FILE_EXISTS) return 'exists';
    throw error;
  }
}
