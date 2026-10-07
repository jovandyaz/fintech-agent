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

/** Inserts each event as the insert-only `copilot_mcp` role (02 G1); `sql` must connect as that role. */
export const createPostgresSecurityEventSink = (
  sql: Sql,
): SecurityEventSink => ({
  record: async (event) => {
    await sql`
      insert into security_events (kind, case_id, run_id, ref_masked)
      values (${event.kind}, ${event.case_id}, ${event.run_id}, ${event.ref_masked})`;
  },
});
