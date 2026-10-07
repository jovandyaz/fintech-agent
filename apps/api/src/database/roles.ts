import { DB_ROLES, type DbRole } from '@fintech-agent/contracts';
import postgres from 'postgres';

/**
 * Lets each 02 G1 role log in with its password from env. Names and passwords
 * travel as bind parameters and Postgres quotes them itself (`%I`, `%L`), so
 * nothing is spliced into SQL text here. The resulting `ALTER ROLE` does reach
 * the server in clear: a server set to log DDL or failed statements records it.
 * Safe to run again.
 */
export async function setRolePasswords(
  ownerUrl: string,
  passwords: Record<DbRole, string>,
): Promise<void> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    for (const role of DB_ROLES) {
      const [row] = await sql<{ statement: string }[]>`
        select format('ALTER ROLE %I WITH LOGIN PASSWORD %L', ${role}::text, ${passwords[role]}::text) as statement`;
      if (row) await sql.unsafe(row.statement);
    }
  } finally {
    await sql.end();
  }
}
