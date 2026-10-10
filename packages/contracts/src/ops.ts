import { z } from 'zod';

/** The alerts `ops:scan-logs` raises over log lines (01 §Observability). */
export const LOG_ALERTS = [
  'pii_in_logs',
  'security_event_unrecorded',
  'auth_rejected_burst',
] as const;
export type LogAlertName = (typeof LOG_ALERTS)[number];

/**
 * One `ops:scan-logs` stdout line: where the alert is in the stream (its
 * 1-based line, the line's own time when it has one, a burst's size), never
 * any of the line's content.
 */
export const LogAlertSchema = z.strictObject({
  alert: z.enum(LOG_ALERTS),
  line: z.number().int().positive(),
  at: z.iso.datetime().optional(),
  count: z.number().int().positive().optional(),
});
export type LogAlert = z.infer<typeof LogAlertSchema>;

/** One `ops:scan-traces` stdout line: where a stored value masking would change is, never the value. */
export const TraceAlertSchema = z.strictObject({
  table: z.string().min(1),
  column: z.string().min(1),
  key: z.string().min(1),
});
export type TraceAlert = z.infer<typeof TraceAlertSchema>;

/** The event of the one line an ops scan that could not run writes. */
export const SCAN_FAILED_EVENT = 'scan_failed';

/** That stderr line, as the api's JSON logger writes it: the reason only, masked. */
export const ScanFailedLineSchema = z.strictObject({
  event: z.literal(SCAN_FAILED_EVENT),
  reason: z.string().min(1),
  level: z.literal('error'),
  message: z.literal(SCAN_FAILED_EVENT),
  timestamp: z.iso.datetime(),
  context: z.string().min(1),
});
