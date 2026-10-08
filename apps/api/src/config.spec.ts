import { describe, expect, it } from 'vitest';

import { loadApiConfig } from './config.js';

const ENV = {
  API_DATABASE_URL: 'postgresql://copilot_api:x@localhost:5433/copilot',
  OPERATOR_TOKENS: 'ana:k1:dev-operator-ana-token-0123456789',
  CORE_MOCK_URL: 'http://localhost:3010',
  CORE_READ_KEY: 'dev-core-read-key',
  MCP_URL: 'http://localhost:3020/mcp',
  MCP_AUDIENCE: 'http://mcp:3020/mcp',
  CASE_TOKEN_KEY: 'dev-case-token-key-0123456789abcdef',
  WEBHOOK_SECRET: 'whsec_ZGV2LXdlYmhvb2stc2VjcmV0LTAxMjM0NTY3ODlhYmNkZWY=',
};

describe('loadApiConfig', () => {
  it('parses the api environment', () => {
    expect(loadApiConfig(ENV)).toMatchObject({ ...ENV, API_PORT: 3000 });
  });

  it('defaults the agent to on, variant A, priced models and a bounded run', () => {
    expect(loadApiConfig(ENV)).toMatchObject({
      ANTHROPIC_API_KEY: '',
      AGENT_MODE: 'on',
      AGENT_VARIANT: 'A',
      AGENT_MODEL_A: 'claude-sonnet-5-5',
      AGENT_MODEL_B: 'claude-haiku-5-5',
      REDACTOR_MODEL: 'claude-haiku-5-5',
      RUN_TIMEOUT_MS: 180_000,
      RUN_COST_CEILING_USD: 0.5,
      RUN_INPUT_TOKEN_CEILING: 60_000,
    });
  });

  it('refuses an input ceiling above the prompt size the prices hold for', () => {
    expect(() =>
      loadApiConfig({ ...ENV, RUN_INPUT_TOKEN_CEILING: '100001' }),
    ).toThrow(/RUN_INPUT_TOKEN_CEILING/);
    expect(
      loadApiConfig({ ...ENV, RUN_INPUT_TOKEN_CEILING: '100000' })
        .RUN_INPUT_TOKEN_CEILING,
    ).toBe(100_000);
  });

  it.each(['AGENT_MODEL_A', 'AGENT_MODEL_B', 'REDACTOR_MODEL'] as const)(
    'refuses a %s with no price',
    (name) => {
      expect(() =>
        loadApiConfig({ ...ENV, [name]: 'claude-unknown-1' }),
      ).toThrow(new RegExp(name));
    },
  );

  it('refuses a run timeout the case token could not outlive', () => {
    expect(() => loadApiConfig({ ...ENV, RUN_TIMEOUT_MS: '540001' })).toThrow(
      /RUN_TIMEOUT_MS/,
    );
    expect(
      loadApiConfig({ ...ENV, RUN_TIMEOUT_MS: '540000' }).RUN_TIMEOUT_MS,
    ).toBe(540_000);
  });

  it('refuses a case token key shorter than 32 bytes', () => {
    expect(() =>
      loadApiConfig({ ...ENV, CASE_TOKEN_KEY: 'k'.repeat(31) }),
    ).toThrow(/CASE_TOKEN_KEY/);
    expect(
      loadApiConfig({ ...ENV, CASE_TOKEN_KEY: 'k'.repeat(32) }).CASE_TOKEN_KEY,
    ).toHaveLength(32);
  });

  it('counts the case token key in bytes, not characters', () => {
    expect(
      loadApiConfig({ ...ENV, CASE_TOKEN_KEY: 'ñ'.repeat(16) }).CASE_TOKEN_KEY,
    ).toHaveLength(16);
  });

  it('reads a key of only spaces as no key', () => {
    expect(
      loadApiConfig({ ...ENV, ANTHROPIC_API_KEY: '  ' }).ANTHROPIC_API_KEY,
    ).toBe('');
  });

  it('turns the agent off with AGENT_MODE=off', () => {
    expect(loadApiConfig({ ...ENV, AGENT_MODE: 'off' }).AGENT_MODE).toBe('off');
  });

  it('runs the worker by default and polls every second when idle', () => {
    expect(loadApiConfig(ENV)).toMatchObject({
      AGENT_WORKER: 'on',
      AGENT_POLL_MS: 1_000,
    });
  });

  it('refuses an AGENT_WORKER other than on or off', () => {
    expect(() => loadApiConfig({ ...ENV, AGENT_WORKER: 'paused' })).toThrow(
      /AGENT_WORKER/,
    );
  });

  it.each(['0', '-1', '1.5', '60001'])(
    'refuses AGENT_POLL_MS=%s: Node clamps an oversized timer to 1 ms',
    (value) => {
      expect(() => loadApiConfig({ ...ENV, AGENT_POLL_MS: value })).toThrow(
        /AGENT_POLL_MS/,
      );
    },
  );

  it.each([
    ['without the whsec_ prefix', 'ZGV2LXdlYmhvb2stc2VjcmV0'],
    ['empty', ''],
  ])('refuses a WEBHOOK_SECRET %s', (_, value) => {
    expect(() => loadApiConfig({ ...ENV, WEBHOOK_SECRET: value })).toThrow(
      /WEBHOOK_SECRET/,
    );
  });

  it('accepts two webhook secrets while one rotates out', () => {
    expect(() =>
      loadApiConfig({
        ...ENV,
        WEBHOOK_SECRET: `${ENV.WEBHOOK_SECRET} whsec_${Buffer.from('a-second-secret-of-24-bytes').toString('base64')}`,
      }),
    ).not.toThrow();
  });

  it('trusts no proxy by default, so a forwarded address is never believed', () => {
    expect(loadApiConfig(ENV).TRUST_PROXY).toBe('');
  });

  it.each([
    '10.231.0.10',
    '10.231.0.0/24',
    '10.231.0.10, 127.0.0.1',
    '::1',
    '::ffff:10.231.0.10',
    '::ffff:10.231.0.0/120',
  ])('accepts TRUST_PROXY %s, addresses and subnets only', (value) => {
    expect(loadApiConfig({ ...ENV, TRUST_PROXY: value }).TRUST_PROXY).toBe(
      value,
    );
  });

  it.each([
    'true',
    'console',
    'loopback',
    '10.231.0.0/33',
    '10.231.0.10,',
    '10.231.0.0/24/1',
    '10.231.0.0/',
    '0.0.0.0/0',
    '::/0',
    '10.0.0.0/8',
    '2001:db8::/32',
    '2001:db8::/129',
    '::ffff:0.0.0.0/96',
    '::ffff:10.0.0.0/104',
    '0:0:0:0:0:ffff:0:0/96',
    '::FFFF:0.0.0.0/96',
    '0000:0000:0000:0000:0000:ffff:0000:0000/96',
    '::ffff:0:0%a:b/96',
    '0:0:0:0:0:ffff:0:0%x:1:2:3/96',
    'fe80::1%eth0',
  ])(
    'refuses TRUST_PROXY %s, which would trust more than one known address',
    (value) => {
      expect(() => loadApiConfig({ ...ENV, TRUST_PROXY: value })).toThrow(
        /TRUST_PROXY/,
      );
    },
  );

  it('refuses an AGENT_MODE other than on or off', () => {
    expect(() => loadApiConfig({ ...ENV, AGENT_MODE: 'paused' })).toThrow(
      /AGENT_MODE/,
    );
  });

  it.each([
    'OPERATOR_TOKENS',
    'CORE_MOCK_URL',
    'CORE_READ_KEY',
    'MCP_URL',
    'MCP_AUDIENCE',
    'CASE_TOKEN_KEY',
  ] as const)('refuses to start without %s', (name) => {
    const env: NodeJS.ProcessEnv = { ...ENV };
    delete env[name];
    expect(() => loadApiConfig(env)).toThrow(new RegExp(name));
  });
});
