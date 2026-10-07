import { DB_ROLES, newFolio, type DbRole } from '@fintech-agent/contracts';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Sql } from 'postgres';

import { migrateDatabase } from '../src/database/migrate.js';
import { setRolePasswords } from '../src/database/roles.js';

const IMAGE = 'postgres:16-alpine';

export interface TestDatabase {
  ownerUrl: string;
  urlFor: (role: DbRole) => string;
  passwordFor: (role: DbRole) => string;
  stop: () => Promise<void>;
}

/** A throwaway Postgres 16 (the compose image), migrated, with every role able to log in. */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(IMAGE).start();
  const ownerUrl = container.getConnectionUri();
  const passwordFor = (role: DbRole): string => `test-${role}`;
  await migrateDatabase(ownerUrl);
  await setRolePasswords(
    ownerUrl,
    Object.fromEntries(
      DB_ROLES.map((role) => [role, passwordFor(role)]),
    ) as Record<DbRole, string>,
  );
  return {
    ownerUrl,
    passwordFor,
    urlFor: (role) => {
      const url = new URL(ownerUrl);
      url.username = role;
      url.password = passwordFor(role);
      return url.toString();
    },
    stop: async () => {
      await container.stop();
    },
  };
}

/** Inserts a queued case as the owner, for tests that need a row to point at. */
export async function insertCase(
  sql: Sql,
  id: string,
  customerId = 'cus_01',
): Promise<void> {
  await sql`
    insert into cases (id, ticket_id, folio, received_at, source, customer_id, text_masked)
    values (${id}, ${`T-${id}`}, ${newFolio()}, now(), 'webhook', ${customerId}, 'hola')`;
}
