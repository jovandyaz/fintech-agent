import type { SecurityEventKind } from '@fintech-agent/contracts';
import type { Sql } from 'postgres';

/** A row for `security_events` (01): who asked for what they do not own. `ref_masked` already went through `maskPii`. */
export interface SecurityEvent {
  kind: SecurityEventKind;
  case_id: string;
  run_id: string;
  ref_masked: string;
}

/** Where the MCP server records security events, one `security_events` row each. */
export interface SecurityEventSink {
  record: (event: SecurityEvent) => Promise<void>;
}

const SECURITY_EVENT_TIMEOUT_MS = 2_000;

/**
 * Inserts each event as the insert-only `copilot_mcp` role (02 G1); `sql` must
 * connect as that role. A database that does not answer within `timeoutMs`
 * fails the record, so the tool still answers NOT_FOUND within its own budget.
 */
export const createPostgresSecurityEventSink = (
  sql: Sql,
  timeoutMs = SECURITY_EVENT_TIMEOUT_MS,
): SecurityEventSink => ({
  record: async (event) => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(`security event insert timed out after ${timeoutMs} ms`),
          ),
        timeoutMs,
      );
    });
    try {
      await Promise.race([
        sql`
          insert into security_events (kind, case_id, run_id, ref_masked)
          values (${event.kind}, ${event.case_id}, ${event.run_id}, ${event.ref_masked})`,
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  },
});
