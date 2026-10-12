import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

import { agentStatusText, type Check, note } from './checks.ts';
import {
  EXIT,
  devOperators,
  effectiveEnv,
  ensureDotEnv,
  envFileDisabled,
  isAnthropicKey,
  keyPlan,
  operatorsOf,
  parseStartArgs,
  withEnvValue,
  type Env,
  type StartArgs,
} from './config.ts';
import { compose, explainFailedStart } from './docker.ts';
import { stackChecks, toolChecks, type Stack } from './preflight.ts';
import {
  REPO_ROOT,
  gitIgnores,
  readRepoFile,
  reasonOf,
  run,
} from './system.ts';
import {
  ask,
  askHidden,
  heading,
  isInteractive,
  printChecks,
  runCommand,
  warn,
} from './terminal.ts';

const HELP = `Usage: pnpm start [options]

Starts Case Copilot with Docker Compose (Postgres, api, executor, MCP server,
core-mock and the ops console), waits until every service is healthy, and
prints where to sign in. Run it again after pulling new code: it rebuilds and
recreates only what changed.

Options:
  --agent-off  Start with the kill switch (AGENT_MODE=off): the console works,
               each case reaches review uninvestigated, nothing calls a model.
  --no-demo    Skip the sample cases ADV-01, CARD-UNREC-01 and CONFLICT-01,
               which it otherwise posts once the stack is up (posting them
               again opens nothing new).
  --check      Run the preflight checks only; start nothing.
  -h, --help   Show this help.

Without ANTHROPIC_API_KEY in your shell or .env it asks, on a terminal, for a
key (saved to .env) or starts with the kill switch; anywhere else (CI, a pipe)
it starts with the kill switch without asking.`;

const DEMO_FIXTURES = ['ADV-01', 'CARD-UNREC-01', 'CONFLICT-01'] as const;
const DOT_ENV = '.env';
const ENV_EXAMPLE = '.env.example';
const KEY_NAME = 'ANTHROPIC_API_KEY';
const AGENT_OFF = 'off';
const KEY_ATTEMPTS = 3;
const OWNER_READ_WRITE = 0o600;
const STATUS_TIMEOUT_MS = 5_000;

function dotEnvCheck(disabled: boolean): Check {
  if (disabled) {
    return note('COMPOSE_DISABLE_ENV_FILE is set: compose ignores .env');
  }
  return existsSync(resolve(REPO_ROOT, DOT_ENV))
    ? note(`.env exists; its values override ${ENV_EXAMPLE}`)
    : note(`.env does not exist yet; pnpm start copies it from ${ENV_EXAMPLE}`);
}

function saveKey(key: string): void {
  const path = resolve(REPO_ROOT, DOT_ENV);
  chmodSync(path, OWNER_READ_WRITE);
  writeFileSync(path, withEnvValue(readFileSync(path, 'utf8'), KEY_NAME, key));
}

// True once a pasted key is saved to .env; false means the kill switch.
async function askForKey(): Promise<boolean> {
  console.log(
    `No ${KEY_NAME} in your shell or .env. Choose how the agent runs:\n` +
      '  1  Paste a key now. It is saved to .env (git-ignored) and the agent investigates each case.\n' +
      '  2  Continue without a key: the kill switch (AGENT_MODE=off). The console works; nothing calls a model.',
  );
  if ((await ask('1 or 2 [2]: ')) !== '1') return false;
  if (gitIgnores(DOT_ENV) === false) {
    warn(
      `.env is not git-ignored here, so the key is not written to it. Add .env to .gitignore, or export ${KEY_NAME} in your shell.`,
    );
    return false;
  }
  for (let attempt = 1; attempt <= KEY_ATTEMPTS; attempt += 1) {
    const key = await askHidden(
      'Paste the key (it is not shown) and press Enter, or press Enter alone to skip: ',
    );
    if (key === '') return false;
    if (isAnthropicKey(key)) {
      saveKey(key);
      console.log(`Saved ${KEY_NAME} to .env.`);
      return true;
    }
    warn('That does not look like an Anthropic API key (sk-ant-…).');
  }
  return false;
}

// Compose lets a shell variable that is set, even to an empty string, win
// over .env, so a key saved there would never reach the stack.
const shellBlanksKey = (): boolean =>
  process.env[KEY_NAME] !== undefined && process.env[KEY_NAME].trim() === '';

function killSwitchReason(
  args: StartArgs,
  env: Record<string, string>,
  disabled: boolean,
): string {
  if (args.agentOff) return '--agent-off';
  if (env.AGENT_MODE === AGENT_OFF)
    return 'AGENT_MODE=off in your shell or .env';
  if (disabled) return `no ${KEY_NAME}, and compose is not reading .env`;
  if (shellBlanksKey()) {
    return `${KEY_NAME} is set but empty in your shell, which overrides .env; unset it`;
  }
  return `no ${KEY_NAME}, and no terminal to ask for one`;
}

async function chooseAgentOff(
  args: StartArgs,
  env: Record<string, string>,
  disabled: boolean,
): Promise<boolean> {
  const plan = keyPlan({
    agentOff: args.agentOff || env.AGENT_MODE === AGENT_OFF,
    hasKey: (env[KEY_NAME] ?? '').trim() !== '',
    interactive: isInteractive(),
    envFileUsable: !disabled && !shellBlanksKey(),
  });
  if (plan === 'use-key') {
    console.log(`Agent on: ${KEY_NAME} is set.`);
    return false;
  }
  if (plan === 'ask' && (await askForKey())) return false;
  console.log(
    `Agent off, the kill switch (AGENT_MODE=off): ${
      plan === 'ask'
        ? 'continuing without a key'
        : killSwitchReason(args, env, disabled)
    }.`,
  );
  return true;
}

const publishedPort = (stack: Stack, service: string): number | undefined =>
  stack.ports.find((port) => port.service === service)?.port;

async function agentState(
  consoleUrl: string,
  token: string | undefined,
): Promise<string> {
  if (!token) return 'unknown: OPERATOR_TOKENS has no token to ask with';
  try {
    const response = await fetch(`${consoleUrl}/api/status`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    if (!response.ok) return `unknown: /api/status answered ${response.status}`;
    const body = (await response.json()) as { agent?: unknown };
    return typeof body.agent === 'string'
      ? agentStatusText(body.agent)
      : 'unknown: /api/status gave no agent state';
  } catch (error) {
    return `unknown: ${reasonOf(error)}`;
  }
}

async function printSummary(
  stack: Stack,
  env: Record<string, string>,
  exampleText: string,
  demoPosted: boolean,
): Promise<void> {
  const consoleUrl = `http://localhost:${publishedPort(stack, 'console') ?? env.CONSOLE_PORT}`;
  const operators = devOperators(
    env.OPERATOR_TOKENS,
    parseEnv(exampleText).OPERATOR_TOKENS,
  );
  const [asker] = operatorsOf(env.OPERATOR_TOKENS);

  heading('Case Copilot is running');
  console.log(`  Console  ${consoleUrl}`);
  if (operators.length > 0) {
    console.log('  Sign in  with a dev operator token (local use only):');
    for (const { id, token } of operators) {
      console.log(`             ${id.padEnd(6)}${token}`);
    }
  } else {
    console.log('  Sign in  with a token from OPERATOR_TOKENS in your .env');
  }
  console.log(`  Agent    ${await agentState(consoleUrl, asker?.token)}`);
  if (stack.running.length > 0) {
    console.log(
      '  The stack was already running: if the console was open, hard-reload it once (Ctrl+Shift+R, Cmd+Shift+R on macOS).',
    );
  }

  heading('Next');
  if (!demoPosted) {
    console.log(
      `  pnpm demo:post ${DEMO_FIXTURES.join(' ')}   post the sample cases`,
    );
  }
  console.log('  docker compose logs -f api   follow the api log');
  console.log('  pnpm stop                    stop the stack, keep its data');
  console.log('  pnpm reset                   delete its data (asks first)');
  console.log(
    '  pnpm e2e:isolated            browser tests on a throwaway stack',
  );
}

async function main(): Promise<number> {
  const args = parseStartArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return EXIT.ok;
  }

  heading('Preflight');
  const disabled = envFileDisabled(process.env);
  if (!printChecks(toolChecks())) {
    console.log('\nFix the items marked FAIL, then run pnpm start again.');
    return EXIT.failed;
  }
  const { checks, stack } = await stackChecks(process.env);
  const ready = printChecks([...checks, dotEnvCheck(disabled)]);
  if (!ready || !stack) {
    console.log('\nFix the items marked FAIL, then run pnpm start again.');
    return EXIT.failed;
  }
  if (args.check) {
    console.log(
      '\nReady. pnpm start would now run: docker compose up --detach --build --wait',
    );
    return EXIT.ok;
  }

  heading('Configuration');
  if (!disabled && ensureDotEnv(REPO_ROOT) === 'created') {
    console.log(
      'Created .env from .env.example (git-ignored; edit it to override defaults).',
    );
  }
  const exampleText = readRepoFile(ENV_EXAMPLE) ?? '';
  const env = effectiveEnv(
    exampleText,
    disabled ? undefined : readRepoFile(DOT_ENV),
    process.env,
  );
  const agentOff = await chooseAgentOff(args, env, disabled);

  heading(
    stack.running.length > 0
      ? `Updating the running stack (${stack.project})`
      : `Starting the stack (${stack.project}); the first build takes a few minutes`,
  );
  const composeEnv: Env = agentOff
    ? { ...process.env, AGENT_MODE: AGENT_OFF }
    : process.env;
  const upExit = await compose(
    ['up', '--detach', '--build', '--wait'],
    composeEnv,
  );
  if (upExit !== EXIT.ok) {
    await explainFailedStart(composeEnv);
    return upExit;
  }

  let demoPosted = false;
  if (args.demo) {
    heading('Posting the sample cases');
    const demoExit = await run('pnpm', ['demo:post', ...DEMO_FIXTURES], {
      ...process.env,
      API_PORT: String(publishedPort(stack, 'api') ?? env.API_PORT),
      WEBHOOK_SECRET: env.WEBHOOK_SECRET,
    });
    demoPosted = demoExit === EXIT.ok;
    if (!demoPosted) {
      warn('Posting the sample cases failed; the stack itself is up.');
    }
  }

  await printSummary(stack, env, exampleText, demoPosted);
  return EXIT.ok;
}

await runCommand(main);
