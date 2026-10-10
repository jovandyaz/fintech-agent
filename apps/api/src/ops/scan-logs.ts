import {
  MCP_SECURITY_LOG_EVENTS,
  type LogAlert,
} from '@fintech-agent/contracts';

import { isClean } from './is-clean.js';

const AUTH_REJECTED_LIMIT = 10;
const AUTH_REJECTED_WINDOW_MS = 5 * 60 * 1_000;

interface TimedLine {
  line: number;
  ms: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Postgres, nginx or a line cut mid-write is not JSON, and is still scanned.
function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function timeOf(value: unknown): number | undefined {
  if (!isRecord(value) || typeof value.timestamp !== 'string') return undefined;
  const ms = Date.parse(value.timestamp);
  return Number.isNaN(ms) ? undefined : ms;
}

const iso = (ms: number): string => new Date(ms).toISOString();

// Lines of several services arrive interleaved, so they are ordered by time;
// windows that share a line belong to one burst.
function burstsOf(lines: readonly TimedLine[]): LogAlert[] {
  const sorted = lines.toSorted((a, b) => a.ms - b.ms || a.line - b.line);
  const bursts: { head: TimedLine; from: number; to: number }[] = [];
  let from = 0;
  let head = sorted[0];
  for (const [to, { ms }] of sorted.entries()) {
    while (head !== undefined && ms - head.ms > AUTH_REJECTED_WINDOW_MS) {
      from += 1;
      head = sorted[from];
    }
    if (head === undefined || to - from + 1 <= AUTH_REJECTED_LIMIT) continue;
    const last = bursts.at(-1);
    if (last !== undefined && from <= last.to) last.to = to;
    else bursts.push({ head, from, to });
  }
  return bursts.map((burst) => ({
    alert: 'auth_rejected_burst',
    line: burst.head.line,
    at: iso(burst.head.ms),
    count: burst.to - burst.from + 1,
  }));
}

/**
 * Scans the services' log lines for the log alerts of 01 §Observability: a
 * value `maskPii` or `maskJson` would still mask (02 G6), a lost fraud signal
 * (`security_event_unrecorded`, 02 G4), and more than 10 `auth_rejected` lines
 * within any 5 minutes by their `timestamp`. A line that is not JSON is
 * scanned as text; one with no readable `timestamp` joins no burst.
 */
export function scanLogLines(lines: Iterable<string>): LogAlert[] {
  const alerts: LogAlert[] = [];
  const rejected: TimedLine[] = [];
  let line = 0;
  for (const text of lines) {
    line += 1;
    const value = parse(text);
    const ms = timeOf(value);
    const where = ms === undefined ? { line } : { line, at: iso(ms) };
    if (!isClean(value)) alerts.push({ alert: 'pii_in_logs', ...where });
    const event = isRecord(value) ? value.event : undefined;
    if (event === MCP_SECURITY_LOG_EVENTS.securityEventUnrecorded) {
      alerts.push({ alert: 'security_event_unrecorded', ...where });
    }
    if (event === MCP_SECURITY_LOG_EVENTS.authRejected && ms !== undefined) {
      rejected.push({ line, ms });
    }
  }
  return [...alerts, ...burstsOf(rejected)];
}
