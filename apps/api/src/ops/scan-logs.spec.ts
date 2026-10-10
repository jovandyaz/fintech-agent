import { describe, expect, it } from 'vitest';

import { scanLogLines } from './scan-logs.js';

const START_MS = Date.parse('2026-10-10T12:00:00.000Z');
const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const CLABE = '002010077777777771';
// Deep enough to overflow a recursive JSON.stringify.
const HOSTILE_DEPTH = 10_000;
const deeplyNested = (): string =>
  `${'{"a":'.repeat(HOSTILE_DEPTH)}1${'}'.repeat(HOSTILE_DEPTH)}`;

const at = (offsetMs: number): string =>
  new Date(START_MS + offsetMs).toISOString();

const authRejected = (offsetMs: number): string =>
  JSON.stringify({
    event: 'auth_rejected',
    reason: 'invalid_token',
    timestamp: at(offsetMs),
  });

const authRejectedEvery = (
  gapMs: number,
  count: number,
  fromMs = 0,
): string[] =>
  Array.from({ length: count }, (_, i) => authRejected(fromMs + i * gapMs));

describe('scanLogLines: PII in logs (01 §Observability, 02 G6)', () => {
  it('flags an unmasked 8-digit run in a JSON line', () => {
    expect(
      scanLogLines(['{"event":"tool_failed","detail":"cuenta 12345678"}']),
    ).toEqual([{ alert: 'pii_in_logs', line: 1 }]);
  });

  it('scans a line that is not JSON as raw text and never echoes it', () => {
    const alerts = scanLogLines([
      '2026-10-10 12:00:00.123 UTC [1] LOG:  database system is ready to accept connections',
      `2026-10-10 12:00:01.456 UTC [7] ERROR:  duplicate key value violates unique constraint, Key (clabe)=(${CLABE}) already exists.`,
    ]);
    expect(alerts).toEqual([{ alert: 'pii_in_logs', line: 2 }]);
    expect(JSON.stringify(alerts)).not.toContain(CLABE.slice(-4));
  });

  it('scans a truncated JSON line as text without throwing', () => {
    expect(
      scanLogLines([
        '{"event":"tool_failed","detail":"cuenta 12345678',
        '{"event":"mcp_listen',
      ]),
    ).toEqual([{ alert: 'pii_in_logs', line: 1 }]);
  });

  it('gives the time of a JSON line that has one', () => {
    expect(
      scanLogLines([
        JSON.stringify({ message: `CLABE ${CLABE}`, timestamp: at(0) }),
      ]),
    ).toEqual([{ alert: 'pii_in_logs', line: 1, at: at(0) }]);
  });
});

describe('scanLogLines: a hostile line', () => {
  it('flags a line nested too deep to read and keeps scanning the next', () => {
    const unrecorded = JSON.stringify({
      event: 'security_event_unrecorded',
      timestamp: at(0),
    });
    expect(scanLogLines([deeplyNested(), unrecorded])).toEqual([
      { alert: 'pii_in_logs', line: 1 },
      { alert: 'security_event_unrecorded', line: 2, at: at(0) },
    ]);
  });
});

describe('scanLogLines: a lost fraud signal (02 G4)', () => {
  it('raises security_event_unrecorded for each such line', () => {
    const line = JSON.stringify({
      event: 'security_event_unrecorded',
      kind: 'cross_customer_lookup',
      case_id: 'case_ab12',
      run_id: 'run_cd34',
      ref_masked: 'tx_f002',
      error: 'Error: connect ECONNREFUSED',
      timestamp: at(0),
    });
    expect(scanLogLines([authRejected(0), line])).toEqual([
      { alert: 'security_event_unrecorded', line: 2, at: at(0) },
    ]);
  });
});

describe('scanLogLines: auth_rejected bursts (> 10 in 5 min)', () => {
  it('raises one alert for 11 lines within 5 minutes', () => {
    expect(scanLogLines(authRejectedEvery(20 * SECOND_MS, 11))).toEqual([
      { alert: 'auth_rejected_burst', line: 1, at: at(0), count: 11 },
    ]);
  });

  it('stays quiet at 10 lines within 5 minutes', () => {
    expect(scanLogLines(authRejectedEvery(20 * SECOND_MS, 10))).toEqual([]);
  });

  it('stays quiet at 11 lines over 6 minutes, which no 5-minute window holds', () => {
    expect(scanLogLines(authRejectedEvery(36 * SECOND_MS, 11))).toEqual([]);
  });

  it('counts every line of a burst in one alert, and a later burst in another', () => {
    const lines = [
      ...authRejectedEvery(10 * SECOND_MS, 15),
      ...authRejectedEvery(10 * SECOND_MS, 12, HOUR_MS),
    ];
    expect(scanLogLines(lines)).toEqual([
      { alert: 'auth_rejected_burst', line: 1, at: at(0), count: 15 },
      { alert: 'auth_rejected_burst', line: 16, at: at(HOUR_MS), count: 12 },
    ]);
  });

  it('orders interleaved services by time and reports the earliest line', () => {
    const lines = authRejectedEvery(20 * SECOND_MS, 11).reverse();
    expect(scanLogLines(lines)).toEqual([
      { alert: 'auth_rejected_burst', line: 11, at: at(0), count: 11 },
    ]);
  });

  it('counts no line without a readable timestamp', () => {
    const untimed = [
      ...Array.from({ length: 6 }, () => '{"event":"auth_rejected"}'),
      ...Array.from({ length: 6 }, () =>
        JSON.stringify({ event: 'auth_rejected', timestamp: 'yesterday' }),
      ),
    ];
    expect(
      scanLogLines([...untimed, ...authRejectedEvery(SECOND_MS, 10)]),
    ).toEqual([]);
  });
});

describe('scanLogLines: a clean log', () => {
  it('raises nothing for api and mcp lines with masked values, folios, amounts and times', () => {
    const lines = [
      JSON.stringify({
        level: 'info',
        message: 'proposal_created',
        timestamp: at(0),
        context: 'Worker',
        folio: 'AC-ZN83-H147',
        action_id: 'act_yiinpjadrvfy',
        run_id: '0b9d3c1e-1d3a-4b7e-9c1e-2f7a1b3c4d5e',
      }),
      JSON.stringify({
        level: 'warn',
        message: 'Cargo de $1,299.50 a la tarjeta ••••1234',
        timestamp: at(SECOND_MS),
        latency_ms: 2_350,
      }),
      JSON.stringify({ event: 'mcp_listening', port: 3020, timestamp: at(0) }),
      JSON.stringify({
        event: 'core_unavailable',
        tool: 'get_customer',
        run_id: 'run_cd34',
        reason: 'fetch failed',
        timestamp: at(2 * SECOND_MS),
      }),
      ...authRejectedEvery(SECOND_MS, 10),
      '',
    ];
    expect(scanLogLines(lines)).toEqual([]);
  });
});
