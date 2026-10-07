import { describe, expect, it } from 'vitest';

import { loadApiConfig } from './config.js';

const ENV = {
  API_DATABASE_URL: 'postgresql://copilot_api:x@localhost:5433/copilot',
  OPERATOR_TOKENS: 'ana:k1:dev-operator-ana-token-0123456789',
  CORE_MOCK_URL: 'http://localhost:3010',
  CORE_READ_KEY: 'dev-core-read-key',
};

describe('loadApiConfig', () => {
  it('parses the api environment', () => {
    expect(loadApiConfig(ENV)).toMatchObject({ ...ENV, API_PORT: 3000 });
  });

  it.each(['OPERATOR_TOKENS', 'CORE_MOCK_URL', 'CORE_READ_KEY'] as const)(
    'refuses to start without %s',
    (name) => {
      const env: NodeJS.ProcessEnv = { ...ENV };
      delete env[name];
      expect(() => loadApiConfig(env)).toThrow(new RegExp(name));
    },
  );
});
