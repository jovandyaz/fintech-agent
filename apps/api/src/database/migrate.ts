import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '../../drizzle');

/**
 * Applies pending migrations as the owner role. Idempotent; `seed` is the only
 * caller in the stack and runs once, so no advisory lock is taken.
 */
export async function migrateDatabase(ownerUrl: string): Promise<void> {
  const client = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}
