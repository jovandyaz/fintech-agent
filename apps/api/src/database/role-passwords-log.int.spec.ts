import { randomUUID } from 'node:crypto';

import { DB_ROLES, type DbRole } from '@fintech-agent/contracts';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { CONTAINER_START_MS, POSTGRES_IMAGE } from '../../test/database.js';
import { migrateDatabase } from './migrate.js';
import { setRolePasswords } from './roles.js';

// Every server path that logs statement text, the sampled ones included. No
// flag for failed statements: the default `log_min_error_statement = error`
// already logs them.
const LOG_EVERY_STATEMENT = [
  'postgres',
  '-c',
  'log_statement=all',
  '-c',
  'log_min_duration_statement=0',
  '-c',
  'log_min_duration_sample=0',
  '-c',
  'log_transaction_sample_rate=1',
];
const UNDEFINED_OBJECT = '42704';
/** How long the container's log may trail a statement that has finished. */
const LOG_LAG_MS = 5_000;
const MISSING_ROLE: DbRole = 'copilot_mcp';
const MISSING_ROLE_AWAY = `${MISSING_ROLE}_away`;

const serverLog: string[] = [];
let container: StartedPostgreSqlContainer;
let ownerUrl: string;
let owner: postgres.Sql;

beforeAll(async () => {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withCommand(LOG_EVERY_STATEMENT)
    .withLogConsumer((stream) =>
      stream
        .setEncoding('utf8')
        .on('data', (text: string) => serverLog.push(text)),
    )
    .start();
  ownerUrl = container.getConnectionUri();
  await migrateDatabase(ownerUrl);
  owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
}, CONTAINER_START_MS);

afterAll(async () => {
  await owner.end();
  await container.stop();
});

function freshPasswords(): Record<DbRole, string> {
  return Object.fromEntries(
    DB_ROLES.map((role) => [role, `pw-${role}-${randomUUID()}`]),
  ) as Record<DbRole, string>;
}

/**
 * Runs `action`, then returns the server log once a statement issued after it
 * shows up there, which also proves the server is logging statements.
 */
async function logAfter(action: () => Promise<unknown>): Promise<string> {
  await action();
  const marker = `log-marker-${randomUUID()}`;
  await owner`select ${marker}::text`;
  return vi.waitFor(
    () => {
      const log = serverLog.join('');
      expect(log).toContain(marker);
      return log;
    },
    { timeout: LOG_LAG_MS },
  );
}

const leaked = (log: string, passwords: Record<DbRole, string>): string[] =>
  Object.values(passwords).filter((password) => log.includes(password));

describe('setRolePasswords and the Postgres log (02 G6)', () => {
  it('logs no password on a server that logs every statement', async () => {
    const passwords = freshPasswords();
    const log = await logAfter(() => setRolePasswords(ownerUrl, passwords));
    expect(leaked(log, passwords)).toEqual([]);
  });

  it('logs no password in the STATEMENT line of a failed ALTER ROLE', async () => {
    const passwords = freshPasswords();
    await owner`alter role ${owner(MISSING_ROLE)} rename to ${owner(MISSING_ROLE_AWAY)}`;
    try {
      const log = await logAfter(() =>
        expect(setRolePasswords(ownerUrl, passwords)).rejects.toMatchObject({
          code: UNDEFINED_OBJECT,
        }),
      );
      expect(log).toContain(`role "${MISSING_ROLE}" does not exist`);
      expect(leaked(log, passwords)).toEqual([]);
    } finally {
      await owner`alter role ${owner(MISSING_ROLE_AWAY)} rename to ${owner(MISSING_ROLE)}`;
    }
  });
});
