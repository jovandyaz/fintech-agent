import { DB_ROLES, type DbRole } from '@fintech-agent/contracts';
import postgres from 'postgres';

// The ALTER ROLE below carries the password in clear (the server builds it
// with `%L`), so this session turns off every path that logs statement text:
// all statements, by duration, sampled by duration, sampled by transaction, on
// error. Sent at startup, they bind this session alone before its first
// statement. They need a superuser: a non-superuser owner is refused at
// connect, so no ALTER runs (fail-closed).
const NO_STATEMENT_TEXT_IN_LOG = {
  log_statement: 'none',
  log_min_duration_statement: '-1',
  log_min_duration_sample: '-1',
  log_transaction_sample_rate: '0',
  log_min_error_statement: 'panic',
} as const;

/** Lets each 02 G1 role log in with its password from env. Safe to run again. */
export async function setRolePasswords(
  ownerUrl: string,
  passwords: Record<DbRole, string>,
): Promise<void> {
  const sql = postgres(ownerUrl, {
    max: 1,
    onnotice: () => undefined,
    connection: NO_STATEMENT_TEXT_IN_LOG,
  });
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
