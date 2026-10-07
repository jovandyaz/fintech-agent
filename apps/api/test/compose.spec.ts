import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface ComposeService {
  environment?: Record<string, string>;
}

const compose = parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../docker-compose.yml'),
    'utf8',
  ),
) as { services: Record<string, ComposeService> };

const holders = (variable: string): string[] =>
  Object.entries(compose.services)
    .filter(([, service]) => variable in (service.environment ?? {}))
    .map(([name]) => name)
    .sort();

const env = (service: string): Record<string, string> =>
  compose.services[service]?.environment ?? {};

describe('compose process boundary (02 G1)', () => {
  it('gives CORE_EXECUTOR_KEY only to the executor and core-mock', () => {
    expect(
      holders('CORE_EXECUTOR_KEY').every((name) =>
        ['core-mock', 'executor'].includes(name),
      ),
    ).toBe(true);
    expect(holders('CORE_EXECUTOR_KEY')).not.toContain('api');
  });

  it('gives the owner database URL only to seed', () => {
    expect(holders('DATABASE_URL')).toEqual(['seed']);
  });

  it('connects api and mcp each with its own role', () => {
    expect(env('api').API_DATABASE_URL).toMatch(/^postgresql:\/\/copilot_api:/);
    expect(env('mcp').MCP_DATABASE_URL).toMatch(/^postgresql:\/\/copilot_mcp:/);
    expect(holders('API_DATABASE_URL')).toEqual(['api']);
    expect(holders('MCP_DATABASE_URL')).toEqual(['mcp']);
  });

  it('starts api and mcp only after seed has migrated', () => {
    const dependsOn = (service: string) =>
      (
        compose.services[service] as {
          depends_on?: Record<string, { condition: string }>;
        }
      ).depends_on ?? {};
    expect(dependsOn('api').seed?.condition).toBe(
      'service_completed_successfully',
    );
    expect(dependsOn('mcp').seed?.condition).toBe(
      'service_completed_successfully',
    );
  });
});
