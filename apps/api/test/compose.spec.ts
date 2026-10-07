import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface ComposeService {
  environment?: Record<string, string> | string[];
  env_file?: unknown;
}

const compose = parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../docker-compose.yml'),
    'utf8',
  ),
) as { services: Record<string, ComposeService> };

const holders = (variable: string): string[] =>
  Object.entries(compose.services)
    .filter(([, service]) => Object.hasOwn(service.environment ?? {}, variable))
    .map(([name]) => name)
    .sort();

const env = (service: string): Record<string, string> => {
  const environment = compose.services[service]?.environment ?? {};
  return Array.isArray(environment) ? {} : environment;
};

describe('compose process boundary (02 G1)', () => {
  it('declares every variable in a map, so the checks below see them all', () => {
    for (const [name, service] of Object.entries(compose.services)) {
      expect(Array.isArray(service.environment), name).toBe(false);
      expect(service.env_file, name).toBeUndefined();
    }
  });

  it('gives CORE_EXECUTOR_KEY only to the executor and core-mock', () => {
    expect(holders('CORE_EXECUTOR_KEY').sort()).toEqual([
      'core-mock',
      'executor',
    ]);
  });

  it('gives the owner database URL only to seed', () => {
    expect(holders('DATABASE_URL')).toEqual(['seed']);
  });

  it('connects api, executor and mcp each with its own role', () => {
    expect(env('api').API_DATABASE_URL).toMatch(/^postgresql:\/\/copilot_api:/);
    expect(env('executor').EXECUTOR_DATABASE_URL).toMatch(
      /^postgresql:\/\/copilot_executor:/,
    );
    expect(holders('EXECUTOR_DATABASE_URL')).toEqual(['executor']);
    expect(env('mcp').MCP_DATABASE_URL).toMatch(/^postgresql:\/\/copilot_mcp:/);
    expect(holders('API_DATABASE_URL')).toEqual(['api']);
    expect(holders('MCP_DATABASE_URL')).toEqual(['mcp']);
  });

  it('starts api, executor and mcp only after seed has migrated', () => {
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
    expect(dependsOn('executor').seed?.condition).toBe(
      'service_completed_successfully',
    );
  });
});
