import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  UsageError,
  devOperators,
  effectiveEnv,
  ensureDotEnv,
  e2eExit,
  envFileDisabled,
  isAnthropicKey,
  isolatedEnv,
  keyPlan,
  operatorsOf,
  parseHelpArgs,
  parseResetArgs,
  parseStartArgs,
  withEnvValue,
} from './config.ts';

const DEV_TOKENS =
  'ana:k1:dev-operator-ana-token-0123456789,beto:k1:dev-operator-beto-token-0123456789';

describe('parseStartArgs', () => {
  it('reads every flag pnpm start takes', () => {
    expect(parseStartArgs(['--agent-off', '--demo', '--check'])).toEqual({
      agentOff: true,
      demo: true,
      check: true,
      help: false,
    });
  });

  it('defaults every flag to off', () => {
    expect(parseStartArgs([])).toEqual({
      agentOff: false,
      demo: false,
      check: false,
      help: false,
    });
  });

  it('drops the -- pnpm passes through, so pnpm start -- --help reaches the script', () => {
    expect(parseStartArgs(['--', '--help']).help).toBe(true);
    expect(parseStartArgs(['--', '-h']).help).toBe(true);
  });

  it('refuses an unknown flag and names it', () => {
    expect(() => parseStartArgs(['--agent-of'])).toThrow(UsageError);
    expect(() => parseStartArgs(['--agent-of'])).toThrow(/--agent-of/);
  });

  it('refuses a positional argument', () => {
    expect(() => parseStartArgs(['demo'])).toThrow(UsageError);
  });
});

describe('parseResetArgs', () => {
  it('reads --yes and -y', () => {
    expect(parseResetArgs(['--yes'])).toEqual({ yes: true, help: false });
    expect(parseResetArgs(['-y'])).toEqual({ yes: true, help: false });
    expect(parseResetArgs([])).toEqual({ yes: false, help: false });
  });

  it('refuses a flag that only start takes', () => {
    expect(() => parseResetArgs(['--demo'])).toThrow(UsageError);
  });
});

describe('parseHelpArgs', () => {
  it('takes only --help', () => {
    expect(parseHelpArgs(['--help'], 'pnpm stop')).toEqual({ help: true });
    expect(parseHelpArgs([], 'pnpm stop')).toEqual({ help: false });
    expect(() => parseHelpArgs(['--yes'], 'pnpm stop')).toThrow(
      /pnpm stop -- --help/,
    );
  });
});

describe('effectiveEnv', () => {
  const EXAMPLE = 'API_PORT=3000\nCONSOLE_PORT=5173\nANTHROPIC_API_KEY=\n';

  it('layers .env over .env.example and the shell over both, as compose does', () => {
    const env = effectiveEnv(EXAMPLE, 'CONSOLE_PORT=5174\nAPI_PORT=3001\n', {
      API_PORT: '3002',
    });
    expect(env.CONSOLE_PORT).toBe('5174');
    expect(env.API_PORT).toBe('3002');
  });

  it('lets an empty shell value win, as compose does', () => {
    const env = effectiveEnv(EXAMPLE, 'ANTHROPIC_API_KEY=sk-ant-x\n', {
      ANTHROPIC_API_KEY: '',
    });
    expect(env.ANTHROPIC_API_KEY).toBe('');
  });

  it('falls back to .env.example when there is no .env', () => {
    expect(effectiveEnv(EXAMPLE, undefined, {}).CONSOLE_PORT).toBe('5173');
  });

  it('skips shell variables that are unset', () => {
    const env = effectiveEnv(EXAMPLE, undefined, { API_PORT: undefined });
    expect(env.API_PORT).toBe('3000');
  });
});

describe('envFileDisabled', () => {
  it('follows COMPOSE_DISABLE_ENV_FILE the way compose reads it', () => {
    expect(envFileDisabled({ COMPOSE_DISABLE_ENV_FILE: '1' })).toBe(true);
    expect(envFileDisabled({ COMPOSE_DISABLE_ENV_FILE: 'TRUE' })).toBe(true);
    expect(envFileDisabled({ COMPOSE_DISABLE_ENV_FILE: '0' })).toBe(false);
    expect(envFileDisabled({})).toBe(false);
  });
});

describe('withEnvValue', () => {
  it('fills the existing line and keeps the rest of the file', () => {
    const text = '# key\nANTHROPIC_API_KEY=\nAPI_PORT=3000\n';
    expect(withEnvValue(text, 'ANTHROPIC_API_KEY', 'sk-ant-abc')).toBe(
      '# key\nANTHROPIC_API_KEY=sk-ant-abc\nAPI_PORT=3000\n',
    );
  });

  it('replaces every assignment, so a later duplicate cannot win', () => {
    const text = 'ANTHROPIC_API_KEY=\nexport ANTHROPIC_API_KEY=old\n';
    expect(withEnvValue(text, 'ANTHROPIC_API_KEY', 'sk-ant-abc')).toBe(
      'ANTHROPIC_API_KEY=sk-ant-abc\nANTHROPIC_API_KEY=sk-ant-abc\n',
    );
  });

  it('leaves a commented-out assignment alone and appends', () => {
    expect(
      withEnvValue('# ANTHROPIC_API_KEY=\n', 'ANTHROPIC_API_KEY', 'v'),
    ).toBe('# ANTHROPIC_API_KEY=\nANTHROPIC_API_KEY=v\n');
  });

  it('appends on a new line when the file does not end with one', () => {
    expect(withEnvValue('API_PORT=3000', 'ANTHROPIC_API_KEY', 'v')).toBe(
      'API_PORT=3000\nANTHROPIC_API_KEY=v\n',
    );
  });

  it('keeps Windows line endings intact', () => {
    expect(
      withEnvValue('ANTHROPIC_API_KEY=\r\nA=1\r\n', 'ANTHROPIC_API_KEY', 'v'),
    ).toBe('ANTHROPIC_API_KEY=v\r\nA=1\r\n');
  });

  it('writes a value holding $ patterns as it is', () => {
    expect(withEnvValue('A=\n', 'A', 'x$&y$1$$')).toBe('A=x$&y$1$$\n');
  });

  it('refuses a value that would break the file', () => {
    expect(() =>
      withEnvValue('', 'ANTHROPIC_API_KEY', 'sk-ant-a\nAGENT_MODE=off'),
    ).toThrow();
  });
});

describe('isAnthropicKey', () => {
  it('takes a key in the sk-ant- form', () => {
    expect(isAnthropicKey('sk-ant-api03-AbC_d-9')).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['another prefix', 'sk-proj-abc'],
    ['a space', 'sk-ant-abc def'],
    ['a quote', 'sk-ant-abc"'],
    ['a newline', 'sk-ant-abc\n'],
  ])('refuses %s', (_, value) => {
    expect(isAnthropicKey(value)).toBe(false);
  });
});

describe('operatorsOf', () => {
  it('reads id:keyId:token entries', () => {
    expect(operatorsOf(DEV_TOKENS)).toEqual([
      { id: 'ana', token: 'dev-operator-ana-token-0123456789' },
      { id: 'beto', token: 'dev-operator-beto-token-0123456789' },
    ]);
  });

  it('skips malformed entries and an unset value', () => {
    expect(operatorsOf('ana:k1, :k2:x,beto')).toEqual([]);
    expect(operatorsOf(undefined)).toEqual([]);
  });
});

describe('devOperators', () => {
  it('shows the tokens while they are the dev values of .env.example', () => {
    expect(devOperators(DEV_TOKENS, DEV_TOKENS)).toHaveLength(2);
  });

  it('never shows tokens someone set on their own', () => {
    expect(
      devOperators('ana:k2:a-real-token-0123456789abcdef', DEV_TOKENS),
    ).toEqual([]);
  });
});

describe('keyPlan', () => {
  const base = {
    agentOff: false,
    hasKey: false,
    interactive: true,
    envFileUsable: true,
  };

  it('uses the key when there is one', () => {
    expect(keyPlan({ ...base, hasKey: true })).toBe('use-key');
  });

  it('asks on a terminal when there is none', () => {
    expect(keyPlan(base)).toBe('ask');
  });

  it('never asks without a terminal: the kill switch instead', () => {
    expect(keyPlan({ ...base, interactive: false })).toBe('kill-switch');
  });

  it('never asks when compose would not read .env', () => {
    expect(keyPlan({ ...base, envFileUsable: false })).toBe('kill-switch');
  });

  it('turns the agent off when asked, even with a key', () => {
    expect(keyPlan({ ...base, hasKey: true, agentOff: true })).toBe(
      'kill-switch',
    );
  });
});

describe('isolatedEnv', () => {
  const plan = {
    subnet: '10.232.0.0/24',
    ipRange: '10.232.0.128/25',
    consoleIp: '10.232.0.10',
  };

  it('names its own project, skips .env and turns the agent off', () => {
    const env = isolatedEnv({ PATH: '/bin', AGENT_MODE: 'on' }, plan);
    expect(env).toMatchObject({
      PATH: '/bin',
      COMPOSE_PROJECT_NAME: 'fintech-e2e',
      COMPOSE_DISABLE_ENV_FILE: '1',
      AGENT_MODE: 'off',
      COMPOSE_SUBNET: '10.232.0.0/24',
      COMPOSE_IP_RANGE: '10.232.0.128/25',
      CONSOLE_IP: '10.232.0.10',
    });
  });

  it('drops a key the shell holds', () => {
    expect(
      isolatedEnv({ ANTHROPIC_API_KEY: 'sk-ant-x' }, plan),
    ).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('leaves the subnet to compose until one is chosen', () => {
    expect(isolatedEnv({}, undefined)).not.toHaveProperty('COMPOSE_SUBNET');
  });
});

describe('ensureDotEnv', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dotenv-'));
    writeFileSync(join(dir, '.env.example'), 'API_PORT=3000\n');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('copies .env.example when there is no .env', () => {
    expect(ensureDotEnv(dir)).toBe('created');
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('API_PORT=3000\n');
  });

  it('never overwrites an existing .env', () => {
    writeFileSync(join(dir, '.env'), 'ANTHROPIC_API_KEY=keep-me\n');
    expect(ensureDotEnv(dir)).toBe('exists');
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(
      'ANTHROPIC_API_KEY=keep-me\n',
    );
  });
});

describe('e2eExit', () => {
  const clean = { testsExit: 0, interrupted: false, cleanupFailed: false };

  it("is the tests' exit when cleanup worked", () => {
    expect(e2eExit(clean)).toBe(0);
    expect(e2eExit({ ...clean, testsExit: 1 })).toBe(1);
  });

  it('fails when the tests passed but the cleanup did not', () => {
    expect(e2eExit({ ...clean, cleanupFailed: true })).toBe(1);
  });

  it('keeps a test failure when the cleanup failed too', () => {
    expect(e2eExit({ ...clean, testsExit: 3, cleanupFailed: true })).toBe(3);
  });

  it('reports Ctrl+C above everything', () => {
    expect(
      e2eExit({ testsExit: 0, interrupted: true, cleanupFailed: true }),
    ).toBe(130);
  });
});
