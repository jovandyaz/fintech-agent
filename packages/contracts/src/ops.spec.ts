import { describe, expect, it } from 'vitest';

import { MCP_SECURITY_LOG_EVENTS } from './mcp.js';
import {
  LOG_ALERTS,
  LogAlertSchema,
  ScanFailedLineSchema,
  TraceAlertSchema,
} from './ops.js';

const AT = '2026-10-10T12:00:00.000Z';

describe('ops scan lines (01 §Observability)', () => {
  it('names the MCP security log events and the log alerts once', () => {
    expect(MCP_SECURITY_LOG_EVENTS).toEqual({
      authRejected: 'auth_rejected',
      securityEventUnrecorded: 'security_event_unrecorded',
    });
    expect(LOG_ALERTS).toEqual([
      'pii_in_logs',
      'security_event_unrecorded',
      'auth_rejected_burst',
    ]);
  });

  it('accepts an alert that says where it is', () => {
    const burst = { alert: 'auth_rejected_burst', line: 3, at: AT, count: 11 };
    const trace = { table: 'cases', column: 'text_masked', key: 'case_01' };
    expect(LogAlertSchema.parse(burst)).toEqual(burst);
    expect(TraceAlertSchema.parse(trace)).toEqual(trace);
  });

  it('refuses an alert that carries what it flagged', () => {
    expect(
      LogAlertSchema.safeParse({ alert: 'pii_in_logs', line: 1, text: 'x' })
        .success,
    ).toBe(false);
    expect(
      TraceAlertSchema.safeParse({
        table: 'cases',
        column: 'text_masked',
        key: 'case_01',
        value: 'x',
      }).success,
    ).toBe(false);
  });

  it('describes the line a scan that could not run writes', () => {
    const line = {
      event: 'scan_failed',
      reason: 'API_DATABASE_URL must be a URL',
      level: 'error',
      message: 'scan_failed',
      timestamp: AT,
      context: 'ScanTraces',
    };
    expect(ScanFailedLineSchema.parse(line)).toEqual(line);
    expect(
      ScanFailedLineSchema.safeParse({ ...line, level: 'info' }).success,
    ).toBe(false);
  });
});
