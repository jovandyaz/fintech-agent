export const SECURITY_EVENT_KINDS = ['cross_customer_lookup'] as const;
export type SecurityEventKind = (typeof SECURITY_EVENT_KINDS)[number];

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
