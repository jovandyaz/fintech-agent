import type { DbRole } from '@fintech-agent/contracts';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

const IMAGE = 'postgres:16-alpine';

export interface TestDatabase {
  ownerUrl: string;
  urlFor: (role: DbRole) => string;
  passwordFor: (role: DbRole) => string;
  stop: () => Promise<void>;
}

/** A throwaway Postgres 16, the compose image; the caller migrates it. */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(IMAGE).start();
  const ownerUrl = container.getConnectionUri();
  const passwordFor = (role: DbRole): string => `test-${role}`;
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
