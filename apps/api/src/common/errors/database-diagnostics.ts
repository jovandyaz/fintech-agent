import { DrizzleQueryError } from 'drizzle-orm';
import postgres from 'postgres';

const SQLSTATE_PATTERN = /^[A-Z0-9]{5}$/;

const FAILURE_CATEGORY = {
  uniqueViolation: 'unique_violation',
  connectionFailure: 'connection_failure',
  transactionConflict: 'transaction_conflict',
  unclassified: 'unclassified',
} as const;

type FailureCategory = (typeof FAILURE_CATEGORY)[keyof typeof FAILURE_CATEGORY];

/**
 * What a database failure may say in a log line or an error. Only fields that
 * name the failure qualify: drizzle's message quotes every bound parameter,
 * and a Postgres message or detail can echo the rejected input.
 */
export interface DatabaseDiagnostics {
  errorName: string;
  failureCategory: FailureCategory;
  sqlState: string | null;
  table?: string;
  column?: string;
  constraint?: string;
}

const FAILURE_CATEGORY_BY_CODE = new Map<unknown, FailureCategory>([
  ['23505', FAILURE_CATEGORY.uniqueViolation],
  ['08006', FAILURE_CATEGORY.connectionFailure],
  ['ECONNREFUSED', FAILURE_CATEGORY.connectionFailure],
  ['40P01', FAILURE_CATEGORY.transactionConflict],
  ['40001', FAILURE_CATEGORY.transactionConflict],
  ['55P03', FAILURE_CATEGORY.transactionConflict],
]);

function queryFailureIn(
  error: unknown,
): DrizzleQueryError | postgres.PostgresError | undefined {
  const visited = new Set<Error>();
  try {
    for (
      let current: unknown = error;
      current instanceof Error && !visited.has(current);
      current = current.cause
    ) {
      if (
        current instanceof DrizzleQueryError ||
        current instanceof postgres.PostgresError
      ) {
        return current;
      }
      visited.add(current);
    }
  } catch {
    // A revoked proxy throws on the prototype read behind instanceof; nothing
    // can read it, so it carries no query values either.
  }
  return undefined;
}

/**
 * Whether the error came from a query, or wraps one as its cause, so it may
 * carry query values: in its message, its fields, or the cause a formatter
 * prints along with it.
 */
export function isDatabaseError(error: unknown): boolean {
  return queryFailureIn(error) !== undefined;
}

/** The whitelisted facts of whatever a query threw, read through any error wrapping it; any other error reports only its name. */
export function databaseDiagnostics(error: unknown): DatabaseDiagnostics {
  const failure = queryFailureIn(error) ?? error;
  const cause = failure instanceof DrizzleQueryError ? failure.cause : failure;
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? cause.code
      : undefined;
  const diagnostics: DatabaseDiagnostics = {
    errorName: error instanceof Error ? error.constructor.name : typeof error,
    failureCategory:
      FAILURE_CATEGORY_BY_CODE.get(code) ?? FAILURE_CATEGORY.unclassified,
    sqlState:
      typeof code === 'string' && SQLSTATE_PATTERN.test(code) ? code : null,
  };
  if (!(cause instanceof postgres.PostgresError)) {
    return diagnostics;
  }
  return {
    ...diagnostics,
    ...(cause.table_name && { table: cause.table_name }),
    ...(cause.column_name && { column: cause.column_name }),
    ...(cause.constraint_name && { constraint: cause.constraint_name }),
  };
}
