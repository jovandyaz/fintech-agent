import {
  maskJson,
  maskPii,
  ScanFailedLineSchema,
  TraceAlertSchema,
  type TraceAlert,
} from '@fintech-agent/contracts';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CLI_TIMEOUT_MS, linesOf, runApiCli } from '../../test/cli.js';
import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';
import type { Database } from '../database/index.js';
import * as schema from '../database/schema.js';
import { scanStoredText } from './scan-traces.js';

const CARD = '4111111111111111';
const RAW = `Pago con la tarjeta ${CARD}`;
// draft_reply and final_reply are stored as written, so an unfolded ellipsis
// must not fire.
const CLEAN_TEXT = `${maskPii(RAW)}. Revisamos tu caso…`;
const FOLIO_GROUP_CHARS = 4;
const SINCE = new Date('2026-10-09T12:00:00.000Z');
const RECENT = new Date('2026-10-10T08:00:00.000Z');
const OLD = new Date('2026-10-08T12:00:00.000Z');
const UNREACHABLE_DB_PASSWORD = 'scan-spec-password-not-real';
const EXIT = { clean: 0, alerts: 1, failed: 2 } as const;
// Deep enough to overflow a recursive JSON.stringify.
const HOSTILE_DEPTH = 10_000;
const deeplyNested = (): string =>
  `${'{"a":'.repeat(HOSTILE_DEPTH)}1${'}'.repeat(HOSTILE_DEPTH)}`;

const SCANNED = [
  ['run_steps', 'input_masked'],
  ['run_steps', 'output_masked'],
  ['audit_log', 'detail_masked'],
  ['cases', 'text_masked'],
  ['cases', 'text_redacted'],
  ['resolutions', 'draft_reply'],
  ['resolutions', 'reasoning_summary'],
  ['proposed_actions', 'justification'],
  ['proposed_actions', 'final_reply'],
  ['security_events', 'ref_masked'],
] as const;
type Scanned = (typeof SCANNED)[number];
type ScannedTable = Scanned[0];

let testDb: TestDatabase;
let owner: postgres.Sql;
let api: postgres.Sql;
let db: Database;
let sequence = 0;

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  api = postgres(testDb.urlFor('copilot_api'), { max: 1 });
  db = drizzle({ client: api, schema });
  // final_reply exists only on a decided proposal, which the trigger admits
  // through a decision alone; the fixture plants it directly.
  await owner`alter table proposed_actions disable trigger enforce_transition_role`;
}, CONTAINER_START_MS);

beforeEach(async () => {
  await owner`truncate cases, audit_log cascade`;
});

afterAll(async () => {
  await api?.end();
  await owner?.end();
  await testDb?.stop();
});

async function plantCaseRun(
  at: Date,
  unmasked: readonly Scanned[] = [],
): Promise<Record<ScannedTable, string>> {
  sequence += 1;
  const isUnmasked = (table: ScannedTable, column: string): boolean =>
    unmasked.some(([t, c]) => t === table && c === column);
  const text = (table: ScannedTable, column: string): string =>
    isUnmasked(table, column) ? RAW : CLEAN_TEXT;
  const json = (table: ScannedTable, column: string): postgres.JSONValue =>
    (isUnmasked(table, column)
      ? { query: RAW }
      : maskJson({ query: RAW })) as postgres.JSONValue;
  const caseId = `case_scan${sequence}`;
  const folio = `AC-SCAN-${String(sequence).padStart(FOLIO_GROUP_CHARS, 'R')}`;
  const runId = `run_scan${sequence}`;
  const actionId = `act_scan${sequence}`;

  await owner`
    insert into cases (id, ticket_id, folio, received_at, source, customer_id, text_masked,
      text_redacted)
    values (${caseId}, ${`T-${caseId}`}, ${folio}, ${at}, 'webhook', 'cus_01',
      ${text('cases', 'text_masked')}, ${text('cases', 'text_redacted')})`;
  await owner`
    insert into agent_runs (id, case_id, variant, model, prompt_version, started_at)
    values (${runId}, ${caseId}, 'A', 'model', 'p1', ${at})`;
  await owner`
    insert into run_steps (run_id, idx, kind, name, input_masked, output_masked)
    values (${runId}, 0, 'tool', 'get_customer', ${owner.json(json('run_steps', 'input_masked'))},
      ${owner.json(json('run_steps', 'output_masked'))})`;
  await owner`
    insert into resolutions (run_id, category, draft_reply, citations, abstained,
      reasoning_summary)
    values (${runId}, 'unrecognized_card_charge', ${text('resolutions', 'draft_reply')}, '[]',
      false, ${text('resolutions', 'reasoning_summary')})`;
  await owner`
    insert into proposed_actions (id, case_id, run_id, agent_type, agent_params, type, params,
      justification, proposed_at, status, decided_by, decided_at, final_reply)
    values (${actionId}, ${caseId}, ${runId}, 'none', '{}', 'none', '{}',
      ${text('proposed_actions', 'justification')}, ${at}, 'approved', 'operator:ana', ${at},
      ${text('proposed_actions', 'final_reply')})`;
  const [audit] = await owner<{ id: string }[]>`
    insert into audit_log (at, actor, event, ref, detail_masked)
    values (${at}, 'agent', 'proposal_created', ${actionId},
      ${owner.json(json('audit_log', 'detail_masked'))})
    returning id`;
  const [event] = await owner<{ id: string }[]>`
    insert into security_events (at, kind, case_id, run_id, ref_masked)
    values (${at}, 'cross_customer_lookup', ${caseId}, ${runId},
      ${text('security_events', 'ref_masked')})
    returning id`;
  return {
    run_steps: `${runId}:0`,
    audit_log: audit?.id ?? '',
    cases: caseId,
    resolutions: runId,
    proposed_actions: actionId,
    security_events: event?.id ?? '',
  };
}

const alertsFor = (
  keys: Record<ScannedTable, string>,
  columns: readonly Scanned[],
): TraceAlert[] =>
  columns.map(([table, column]) => ({ table, column, key: keys[table] }));

describe('scanStoredText: the trace half of the PII sink scan (01 §Observability, 02 G6)', () => {
  it.each(SCANNED.map((scanned) => ({ scanned, name: scanned.join('.') })))(
    'flags an unmasked card in $name, by key, and no masked row',
    async ({ scanned }) => {
      await plantCaseRun(RECENT);
      const keys = await plantCaseRun(RECENT, [scanned]);

      expect(await scanStoredText(db, SINCE)).toEqual(
        alertsFor(keys, [scanned]),
      );
    },
  );

  it('flags every scanned column at once, in a fixed order', async () => {
    const keys = await plantCaseRun(RECENT, SCANNED);

    expect(await scanStoredText(db, SINCE)).toEqual(alertsFor(keys, SCANNED));
  });

  it('passes the rows the write path masks', async () => {
    await plantCaseRun(RECENT);

    expect(await scanStoredText(db, SINCE)).toEqual([]);
  });

  it('flags a value nested too deep to read and keeps scanning the rest', async () => {
    const keys = await plantCaseRun(RECENT, [['cases', 'text_masked']]);
    await owner`
      update run_steps set output_masked = ${deeplyNested()}::jsonb
      where run_id = ${keys.resolutions}`;

    expect(await scanStoredText(db, SINCE)).toEqual(
      alertsFor(keys, [
        ['run_steps', 'output_masked'],
        ['cases', 'text_masked'],
      ]),
    );
  });

  it('scans a case on the dataset clock by when its event row arrived (01 Case clock)', async () => {
    const keys = await plantCaseRun(OLD, [['cases', 'text_masked']]);
    await owner`
      insert into webhook_events (event_id, payload_hash, case_id, received_at)
      values (${`evt-${keys.cases}`}, 'hash', ${keys.cases}, ${RECENT})`;

    expect(await scanStoredText(db, SINCE)).toEqual(
      alertsFor(keys, [['cases', 'text_masked']]),
    );
  });

  it('ignores rows written before since', async () => {
    await plantCaseRun(OLD, SCANNED);

    expect(await scanStoredText(db, SINCE)).toEqual([]);
  });
});

describe('pnpm ops:scan-traces', () => {
  const run = (databaseUrl: string): ReturnType<typeof runApiCli> =>
    runApiCli('src/ops/scan-traces.main.ts', {
      args: ['--since', SINCE.toISOString()],
      env: { API_DATABASE_URL: databaseUrl },
    });

  it(
    'prints each alert as one JSON line, with no stored content, and exits 1',
    async () => {
      const keys = await plantCaseRun(RECENT, [['cases', 'text_masked']]);

      const scan = run(testDb.urlFor('copilot_api'));

      expect(scan.status).toBe(EXIT.alerts);
      expect(linesOf(scan.stdout, TraceAlertSchema)).toEqual(
        alertsFor(keys, [['cases', 'text_masked']]),
      );
      expect(scan.stdout).not.toContain(CARD.slice(-4));
    },
    CLI_TIMEOUT_MS,
  );

  it(
    'prints nothing and exits 0 over masked rows',
    async () => {
      await plantCaseRun(RECENT);

      const scan = run(testDb.urlFor('copilot_api'));

      expect([scan.status, scan.stdout]).toEqual([EXIT.clean, '']);
    },
    CLI_TIMEOUT_MS,
  );

  it(
    'exits 2 with one masked log line when the scan cannot run',
    () => {
      const scan = run(
        `postgresql://copilot_api:${UNREACHABLE_DB_PASSWORD}@127.0.0.1:1/copilot`,
      );

      expect([scan.status, scan.stdout]).toEqual([EXIT.failed, '']);
      expect(linesOf(scan.stderr, ScanFailedLineSchema)).toHaveLength(1);
      expect(scan.stderr).not.toContain(UNREACHABLE_DB_PASSWORD);
    },
    CLI_TIMEOUT_MS,
  );
});
