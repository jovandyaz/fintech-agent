import { DB_ROLES, type DbRole } from '@fintech-agent/contracts';
import postgres from 'postgres';

/** Lets each 02 G1 role log in with its password from env. Safe to run again. */
export async function setRolePasswords(
  ownerUrl: string,
  passwords: Record<DbRole, string>,
): Promise<void> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    // Names and passwords travel as bind parameters and the server quotes them
    // (`%I`, `%L`); the resulting ALTER ROLE still reaches a DDL-logging server.
    for (const role of DB_ROLES) {
      const [row] = await sql<{ statement: string }[]>`
        select format('ALTER ROLE %I WITH LOGIN PASSWORD %L', ${role}::text, ${passwords[role]}::text) as statement`;
      if (row) await sql.unsafe(row.statement);
    }
  } finally {
    await sql.end();
  }
}
