import { loadApiConfig, type ApiConfig } from '../src/config.js';

const DEV_ENV = {
  API_DATABASE_URL: 'postgresql://copilot_api:x@db:5432/copilot',
  OPERATOR_TOKENS: 'ana:k1:dev-operator-ana-token-0123456789',
  CORE_MOCK_URL: 'http://core-mock:3010',
  CORE_READ_KEY: 'dev-core-read-key',
  MCP_URL: 'http://mcp:3020/mcp',
  MCP_AUDIENCE: 'http://mcp:3020/mcp',
  CASE_TOKEN_KEY: 'dev-case-token-key-0123456789abcdef',
};

/** A full `api` config with the compose dev defaults, for code under test. */
export const testApiConfig = (
  overrides: Record<string, string> = {},
): ApiConfig => loadApiConfig({ ...DEV_ENV, ...overrides });
