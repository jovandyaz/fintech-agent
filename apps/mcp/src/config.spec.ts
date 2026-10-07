import { describe, expect, it } from 'vitest';

import { loadMcpConfig } from './config.js';

const ENV = {
  CORE_MOCK_URL: 'http://core-mock:3010',
  CORE_READ_KEY: 'read-key',
  CASE_TOKEN_KEY: 'case-token-key-with-at-least-32-bytes',
  MCP_AUDIENCE: 'http://mcp:3020/mcp',
  MCP_DATABASE_URL: 'postgresql://copilot_mcp:pw@db:5432/copilot',
};

describe('MCP config', () => {
  it('reads the dial hosts as a trimmed list and defaults the port', () => {
    expect(
      loadMcpConfig({ ...ENV, MCP_ALLOWED_HOSTS: ' mcp , mcp.internal ,' }),
    ).toMatchObject({
      MCP_ALLOWED_HOSTS: ['mcp', 'mcp.internal'],
      MCP_PORT: 3020,
    });
  });

  it.each(Object.keys(ENV))('refuses to start without %s', (name) => {
    expect(() => loadMcpConfig({ ...ENV, [name]: undefined })).toThrow();
  });
});
