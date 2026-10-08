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

  it('gives CASE_TOKEN_KEY only to api, which signs case tokens, and mcp, which verifies them (02 G4)', () => {
    expect(holders('CASE_TOKEN_KEY')).toEqual(['api', 'mcp']);
  });

  it('starts api only once mcp is healthy, so the worker never claims a case it cannot run', () => {
    const dependsOn = (
      compose.services.api as {
        depends_on?: Record<string, { condition: string }>;
      }
    ).depends_on;
    expect(dependsOn?.mcp?.condition).toBe('service_healthy');
  });

  it('gives api a stop grace period past the run timeout, so a stop lets the attempt in flight finish', () => {
    const grace = (compose.services.api as { stop_grace_period?: string })
      .stop_grace_period;
    // The config's ceiling: a 600 s case token minus its 60 s margin.
    const MAX_RUN_TIMEOUT_S = 540;
    expect(Number.parseInt(grace ?? '0', 10)).toBeGreaterThan(
      MAX_RUN_TIMEOUT_S,
    );
  });

  it('runs the agent worker in api with its switches declared', () => {
    expect(env('api')).toMatchObject({
      AGENT_WORKER: '${AGENT_WORKER:-on}',
      AGENT_POLL_MS: '${AGENT_POLL_MS:-1000}',
    });
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

  it('restarts the executor and checks it is alive, so the sweeper always comes back (01 failure handling)', () => {
    const executor = compose.services.executor as {
      restart?: string;
      healthcheck?: { test?: unknown };
    };
    expect(executor.restart).toBe('unless-stopped');
    expect(JSON.stringify(executor.healthcheck?.test)).toContain(
      'executor-alive',
    );
  });
});

describe('compose database logs (02 G6)', () => {
  it('keeps key values and failing rows out of the Postgres log', () => {
    const { command } = compose.services.db as { command?: string[] };
    expect(command).toEqual(['postgres', '-c', 'log_error_verbosity=terse']);
  });
});
