import { databaseDiagnostics } from './database-diagnostics.js';

const UNIQUE_VIOLATION = '23505';

/**
 * Whether a query failed on the named unique constraint, read through any
 * Drizzle wrapping. Ported from Knowtis, built on `databaseDiagnostics` so it
 * reads only the whitelisted fields, never the message.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const { sqlState, constraint: violated } = databaseDiagnostics(error);
  return sqlState === UNIQUE_VIOLATION && violated === constraint;
}
