import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  newFolio,
  type ActionStatus,
  type ActionType,
  type CaseFlag,
  type CaseSource,
  type CaseStatus,
  type GuardOutcome,
  type RejectCode,
  type RunStatus,
  type StopReason,
} from '@fintech-agent/contracts';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { CanaryDefect } from '../src/canaries/templates.js';
import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from './database.js';

const OPS_DIR = resolve(import.meta.dirname, '../../../ops');
const ALERTS = readFileSync(resolve(OPS_DIR, 'alerts.sql'), 'utf8');
const METRICS = readFileSync(resolve(OPS_DIR, 'metrics.sql'), 'utf8');
const BLOCK_NAME = /^-- name: (\w+)$/gm;

// Must hold one block per table alert of 01 §Observability, in file order.
const ALERT_BLOCKS = [
  'canary_catch_rate',
  'execution_without_decision',
  'open_dispute_overdue',
  'oldest_queued',
  'fallback_or_provider_error_rate',
  'reply_quality_regression',
  'injection_or_validation_block_rate',
  'cost_per_case_p95',
  'cross_customer_lookup',
  'redactor_degraded',
] as const;
const METRIC_BLOCKS = ['rejects_by_code'] as const;

function query(name: string, file = ALERTS): string {
  const block = file
    .split(/^-- name: /m)
    .find((part) => part.startsWith(`${name}\n`));
  if (!block) throw new Error(`ops has no query named ${name}`);
  return block.slice(block.indexOf('\n') + 1);
}

const blockNames = (file: string): string[] =>
  [...file.matchAll(BLOCK_NAME)].map((match) => match[1] ?? '');

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// Months before any real clock this suite runs on, so a block that reads
// now() instead of its clock sees every fixture as stale and stays quiet.
const NOW = new Date('2026-03-04T18:00:00Z');
const before = (ms: number): Date => new Date(NOW.getTime() - ms);
const after = (ms: number): Date => new Date(NOW.getTime() + ms);

const OPERATOR = 'operator:ana';
const CANARY_DEFECT: CanaryDefect = 'cold_tone';
const EVAL: CaseSource = 'eval';

let db: TestDatabase;
let owner: postgres.Sql;
let api: postgres.Sql;
let sequence = 0;

const nextId = (prefix: string): string => {
  sequence += 1;
  return `${prefix}_${sequence}`;
};

async function rows(
  text: string,
  sql: postgres.Sql = owner,
): Promise<Record<string, unknown>[]> {
  const result = await sql.unsafe<Record<string, unknown>[]>(text);
  return result.map((row) => ({ ...row }));
}

async function setClock(setting: string, value: string): Promise<void> {
  await owner`select set_config(${setting}, ${value}, false)`;
}

const setNow = (iso: string): Promise<void> => setClock('alerts.now', iso);

interface CaseFixture {
  source?: CaseSource;
  status?: CaseStatus;
  receivedAt?: Date;
  nextAttemptAt?: Date;
  lockedUntil?: Date;
  flags?: CaseFlag[];
  canary?: boolean;
}

async function plantCase(fixture: CaseFixture = {}): Promise<string> {
  const id = nextId('case');
  const {
    source = 'webhook',
    status = 'needs_review',
    receivedAt = NOW,
    nextAttemptAt = NOW,
    lockedUntil = null,
    flags = [],
  } = fixture;
  await owner`
    insert into cases (id, ticket_id, folio, received_at, source, customer_id, text_masked,
      status, next_attempt_at, claim_token, locked_until, flags)
    values (${id}, ${`T-${id}`}, ${newFolio()}, ${receivedAt}, ${source}, 'cus_01', 'hola',
      ${status}, ${nextAttemptAt}, ${lockedUntil ? randomUUID() : null}, ${lockedUntil},
      ${owner.json(flags)})`;
  if (fixture.canary)
    await owner`insert into canary_cases (case_id, defect) values (${id}, ${CANARY_DEFECT})`;
  return id;
}

interface RunFixture {
  startedAt: Date;
  status?: RunStatus;
  stopReason?: StopReason | null;
  costUsd?: string;
}

async function plantRun(caseId: string, fixture: RunFixture): Promise<string> {
  const id = nextId('run');
  const {
    status = 'succeeded',
    stopReason = 'completed',
    costUsd = '0',
  } = fixture;
  await owner`
    insert into agent_runs (id, case_id, variant, model, prompt_version, status, stop_reason,
      cost_usd, started_at)
    values (${id}, ${caseId}, 'v1', 'model', 'p1', ${status}, ${stopReason}, ${costUsd},
      ${fixture.startedAt})`;
  return id;
}

async function plantRuns(
  caseId: string,
  count: number,
  fixture: RunFixture,
): Promise<void> {
  for (let i = 0; i < count; i += 1) await plantRun(caseId, fixture);
}

interface ProposalFixture {
  status: ActionStatus;
  type?: ActionType;
  isCanary?: boolean;
  decidedAt?: Date | null;
  decidedBy?: string | null;
  rejectCode?: RejectCode | null;
  replyEditRatio?: number | null;
  operatorOverride?: boolean;
}

const UNDECIDED: readonly ActionStatus[] = ['proposed', 'superseded'];

async function plantProposal(
  caseId: string,
  fixture: ProposalFixture,
): Promise<string> {
  const id = nextId('act');
  const undecided = UNDECIDED.includes(fixture.status);
  const {
    status,
    type = 'none',
    isCanary = false,
    decidedAt = undecided ? null : before(HOUR_MS),
    decidedBy = undecided ? null : OPERATOR,
    rejectCode = null,
    replyEditRatio = null,
    operatorOverride = false,
  } = fixture;
  await owner`
    insert into proposed_actions (id, case_id, agent_type, agent_params, type, params,
      justification, status, is_canary, decided_by, decided_at, final_reply, reject_code,
      reply_edit_ratio, operator_override)
    values (${id}, ${caseId}, ${type}, '{}', ${type}, '{}', 'x', ${status}, ${isCanary},
      ${decidedBy}, ${decidedAt}, ${undecided ? null : 'listo'}, ${rejectCode},
      ${replyEditRatio}, ${operatorOverride})`;
  return id;
}

async function plantProposals(
  caseId: string,
  count: number,
  fixture: ProposalFixture,
): Promise<void> {
  for (let i = 0; i < count; i += 1) await plantProposal(caseId, fixture);
}

beforeAll(async () => {
  db = await startTestDatabase();
  owner = postgres(db.ownerUrl, { max: 1, onnotice: () => undefined });
  api = postgres(db.urlFor('copilot_api'), { max: 1 });
  // Fixtures plant end states directly, including ones the triggers refuse,
  // so each block is shown to hold without them.
  await owner`alter table proposed_actions disable trigger enforce_transition_role`;
  await owner`alter table action_executions disable trigger enforce_execution_of_approved`;
}, CONTAINER_START_MS);

beforeEach(async () => {
  await owner`truncate cases cascade`;
  await setNow(NOW.toISOString());
  await setClock('metrics.window', '');
});

afterAll(async () => {
  await api?.end();
  await owner?.end();
  await db?.stop();
});

describe('ops/alerts.sql and ops/metrics.sql', () => {
  it('hold one block per table alert of 01 and the rejects dashboard', () => {
    expect(blockNames(ALERTS)).toEqual(ALERT_BLOCKS);
    expect(blockNames(METRICS)).toEqual(METRIC_BLOCKS);
  });

  it.each([
    ...ALERT_BLOCKS.map((name) => [name, ALERTS] as const),
    ...METRIC_BLOCKS.map((name) => [name, METRICS] as const),
  ])('%s runs as copilot_api (ops/README.md)', async (name, file) => {
    await expect(rows(query(name, file), api)).resolves.toEqual([]);
  });
});

describe('canary_catch_rate (01 Alerts)', () => {
  const CANARY_WINDOW = 20;

  async function decided(
    operator: string,
    status: Extract<
      ActionStatus,
      'canary_caught' | 'canary_missed' | 'rejected'
    >,
    minutesAgo: number,
  ): Promise<void> {
    await plantProposal('case_al', {
      status,
      isCanary: status !== 'rejected',
      decidedBy: `operator:${operator}`,
      decidedAt: before(minutesAgo * MINUTE_MS),
      rejectCode: status === 'canary_missed' ? null : 'tone',
    });
  }

  it('names each operator who missed a canary among their last 20', async () => {
    await owner`
      insert into cases (id, ticket_id, folio, received_at, source, customer_id, text_masked)
      values ('case_al', 'T-case_al', ${newFolio()}, ${NOW}, 'webhook', 'cus_01', 'hola')`;
    for (let i = 0; i < CANARY_WINDOW; i += 1)
      await decided('ana', 'canary_caught', i);
    for (let i = 1; i < CANARY_WINDOW; i += 1)
      await decided('beto', 'canary_caught', i);
    await decided('beto', 'canary_missed', 0);
    for (let i = 0; i < CANARY_WINDOW; i += 1)
      await decided('caro', 'canary_caught', i);
    for (let i = 0; i < 5; i += 1)
      await decided('caro', 'canary_missed', 100 + i);
    await decided('dani', 'canary_caught', 1);
    await decided('dani', 'canary_missed', 2);
    for (let i = 0; i < 3; i += 1) await decided('eli', 'rejected', i);

    expect(await rows(query('canary_catch_rate'))).toEqual([
      { operator: 'operator:beto', caught: '19', decided: '20' },
      { operator: 'operator:dani', caught: '1', decided: '2' },
    ]);
  });
});

describe('execution_without_decision: any execution an operator did not decide', () => {
  const EXECUTABLE_TYPE: ActionType = 'resend_cep';

  async function executed(
    fixture: ProposalFixture,
    caseFixture: CaseFixture = {},
  ): Promise<string> {
    const actionId = await plantProposal(await plantCase(caseFixture), {
      type: EXECUTABLE_TYPE,
      ...fixture,
    });
    await owner`insert into action_executions (action_id, status) values (${actionId}, 'started')`;
    return actionId;
  }

  it('pages on an execution with no decider, no decision time or a status no approval reaches, canaries and eval cases included', async () => {
    const breaches = [
      await executed({ status: 'approved', decidedBy: null }),
      await executed({ status: 'executed', decidedAt: null }),
      await executed({ status: 'proposed' }),
      await executed({ status: 'canary_missed', isCanary: true }),
      await executed({ status: 'proposed' }, { source: EVAL }),
    ];
    await executed({ status: 'approved' });

    const fired = await rows(query('execution_without_decision'));

    expect(fired.map((row) => row['action_id'])).toEqual(breaches.toSorted());
  });

  it('pages on any execution of a canary or an eval case, even one recorded as decided', async () => {
    const breaches = [
      await executed({ status: 'executed', isCanary: true }),
      await executed({ status: 'executed' }, { source: EVAL }),
    ];
    await executed({ status: 'executed' });

    const fired = await rows(query('execution_without_decision'));

    expect(fired.map((row) => row['action_id'])).toEqual(breaches.toSorted());
  });

  it('pages on an execution decided by an actor other than an operator', async () => {
    const breach = await executed({
      status: 'executed',
      decidedBy: 'agent:case-copilot',
    });
    await executed({ status: 'executed', decidedBy: OPERATOR });

    const fired = await rows(query('execution_without_decision'));

    expect(fired.map((row) => row['action_id'])).toEqual([breach]);
  });

  it('pages on an execution of a canary case whose action lost its canary flag', async () => {
    const breach = await executed({ status: 'executed' }, { canary: true });
    await executed({ status: 'executed' });

    const fired = await rows(query('execution_without_decision'));

    expect(fired.map((row) => row['action_id'])).toEqual([breach]);
  });

  it('pages on any execution of a none, which the executor never claims', async () => {
    const breach = await executed({ status: 'executed', type: 'none' });
    await executed({ status: 'executed' });

    const fired = await rows(query('execution_without_decision'));

    expect(fired.map((row) => row['action_id'])).toEqual([breach]);
  });

  it('stays quiet when every execution follows an operator decision', async () => {
    await executed({ status: 'approved' });
    await executed({ status: 'executed' });
    await executed({ status: 'failed' });

    expect(await rows(query('execution_without_decision'))).toEqual([]);
  });
});

describe('open_dispute_overdue: proposed past the first business day', () => {
  const FRIDAY_10_LOCAL = new Date('2026-10-09T10:00:00-06:00');
  const TUESDAY_00_LOCAL = new Date('2026-10-13T00:00:00-06:00');
  const TUESDAY_00_01_LOCAL = '2026-10-13T00:01:00-06:00';

  async function dispute(
    fixture: Partial<ProposalFixture> = {},
    caseFixture: CaseFixture = {},
  ): Promise<{ caseId: string; actionId: string }> {
    const caseId = await plantCase({
      receivedAt: FRIDAY_10_LOCAL,
      ...caseFixture,
    });
    const actionId = await plantProposal(caseId, {
      status: 'proposed',
      type: 'open_dispute',
      ...fixture,
    });
    return { caseId, actionId };
  }

  it.each([
    ['Saturday noon', '2026-10-10T12:00:00-06:00'],
    ['Sunday noon', '2026-10-11T12:00:00-06:00'],
    ['Monday 23:59', '2026-10-12T23:59:00-06:00'],
  ])(
    'stays quiet on %s for a dispute received Friday 10:00 Mexico City',
    async (_, now) => {
      await setNow(now);
      await dispute();

      expect(await rows(query('open_dispute_overdue'))).toEqual([]);
    },
  );

  it('pages on Tuesday 00:01 Mexico City, once Monday has ended', async () => {
    await setNow(TUESDAY_00_01_LOCAL);
    const { caseId, actionId } = await dispute();

    expect(await rows(query('open_dispute_overdue'))).toEqual([
      { action_id: actionId, case_id: caseId, deadline: TUESDAY_00_LOCAL },
    ]);
  });

  it('counts from the Mexico City date: received Thursday 20:00 local, Friday in UTC, it pages Saturday 00:01', async () => {
    await setNow('2026-10-10T00:01:00-06:00');
    const { actionId } = await dispute(
      {},
      { receivedAt: new Date('2026-10-08T20:00:00-06:00') },
    );

    const fired = await rows(query('open_dispute_overdue'));

    expect(fired.map((row) => row['action_id'])).toEqual([actionId]);
  });

  it('ignores a decided dispute, another action, a canary and an eval case', async () => {
    await setNow(TUESDAY_00_01_LOCAL);
    const { actionId } = await dispute();
    await dispute({ status: 'approved' });
    await dispute({ type: 'none' });
    await dispute({ isCanary: true });
    await dispute({}, { source: EVAL });

    const fired = await rows(query('open_dispute_overdue'));

    expect(fired.map((row) => row['action_id'])).toEqual([actionId]);
  });
});

describe('oldest_queued: a case waiting for a worker more than 15 minutes', () => {
  const THRESHOLD_MS = 15 * MINUTE_MS;

  async function investigating(
    lockedUntil: Date,
    caseFixture: CaseFixture = {},
  ): Promise<string> {
    return plantCase({
      status: 'investigating',
      nextAttemptAt: before(HOUR_MS),
      lockedUntil,
      ...caseFixture,
    });
  }

  it('pages with the oldest due time and how many are past it', async () => {
    const oldest = before(THRESHOLD_MS + MINUTE_MS);
    await plantCase({ status: 'queued', nextAttemptAt: oldest });
    await plantCase({
      status: 'queued',
      nextAttemptAt: before(THRESHOLD_MS + SECOND_MS),
    });
    await plantCase({ status: 'queued', nextAttemptAt: before(MINUTE_MS) });

    expect(await rows(query('oldest_queued'))).toEqual([
      { overdue: '2', oldest_due: oldest },
    ]);
  });

  it('stays quiet at exactly 15 minutes, for a case not queued and for an eval case', async () => {
    await plantCase({ status: 'queued', nextAttemptAt: before(THRESHOLD_MS) });
    await plantCase({ status: 'needs_review', nextAttemptAt: before(HOUR_MS) });
    await plantCase({
      status: 'queued',
      source: EVAL,
      nextAttemptAt: before(HOUR_MS),
    });

    expect(await rows(query('oldest_queued'))).toEqual([]);
  });

  it('pages on an investigating case whose lease ran out more than 15 minutes ago, dated from the lease', async () => {
    const leaseEnd = before(THRESHOLD_MS + MINUTE_MS);
    await investigating(leaseEnd);

    expect(await rows(query('oldest_queued'))).toEqual([
      { overdue: '1', oldest_due: leaseEnd },
    ]);
  });

  it('stays quiet on a live lease, a lease out exactly 15 minutes and an eval case, however long ago they were due', async () => {
    await investigating(after(MINUTE_MS));
    await investigating(before(THRESHOLD_MS));
    await investigating(before(HOUR_MS), { source: EVAL });

    expect(await rows(query('oldest_queued'))).toEqual([]);
  });
});

describe('fallback_or_provider_error_rate: > 10% of runs over 30 minutes, n ≥ 10', () => {
  const MIN_RUNS = 10;
  const WINDOW_MS = 30 * MINUTE_MS;
  const inWindow: RunFixture = { startedAt: before(10 * MINUTE_MS) };
  const fallback: RunFixture = { ...inWindow, status: 'fallback' };
  const failed: RunFixture = {
    ...inWindow,
    status: 'failed',
    stopReason: 'error',
  };

  it('pages at 2 of 10 runs in fallback or failed', async () => {
    const real = await plantCase();
    await plantRuns(real, MIN_RUNS - 2, inWindow);
    await plantRun(real, fallback);
    await plantRun(real, failed);

    expect(await rows(query('fallback_or_provider_error_rate'))).toEqual([
      { runs: '10', failing: '2' },
    ]);
  });

  it('stays quiet at exactly 10%', async () => {
    const real = await plantCase();
    await plantRuns(real, MIN_RUNS - 1, inWindow);
    await plantRun(real, failed);

    expect(await rows(query('fallback_or_provider_error_rate'))).toEqual([]);
  });

  it('stays quiet at 9 runs all failed, a run started 30 minutes ago being outside', async () => {
    const real = await plantCase();
    await plantRuns(real, MIN_RUNS - 1, failed);
    await plantRun(real, { startedAt: before(WINDOW_MS) });

    expect(await rows(query('fallback_or_provider_error_rate'))).toEqual([]);
  });

  it('counts no run of an eval or a canary case', async () => {
    const real = await plantCase();
    await plantRuns(real, MIN_RUNS - 3, inWindow);
    await plantRuns(real, 2, failed);
    await plantRun(await plantCase({ source: EVAL }), inWindow);
    await plantRun(await plantCase({ canary: true }), inWindow);

    expect(await rows(query('fallback_or_provider_error_rate'))).toEqual([]);
  });

  it('stays quiet with the kill switch on, whose runs all end in an agent_disabled fallback', async () => {
    await plantRuns(await plantCase(), MIN_RUNS, {
      ...fallback,
      stopReason: 'agent_disabled',
    });

    expect(await rows(query('fallback_or_provider_error_rate'))).toEqual([]);
  });

  it('counts finished runs only: a running one is out, an abandoned one with no stop reason is in', async () => {
    const real = await plantCase();
    await plantRuns(real, MIN_RUNS - 3, inWindow);
    await plantRuns(real, 2, failed);
    await plantRun(real, {
      ...inWindow,
      status: 'abandoned',
      stopReason: null,
    });
    await plantRun(real, { ...inWindow, status: 'running', stopReason: null });

    expect(await rows(query('fallback_or_provider_error_rate'))).toEqual([
      { runs: '10', failing: '2' },
    ]);
  });
});

describe('reply_quality_regression: poor decisions over 7 days > the prior 28 days + 10 pp, n ≥ 20', () => {
  const MIN_DECISIONS = 20;
  const RECENT_WINDOW_MS = 7 * DAY_MS;
  const LOOKBACK_MS = 35 * DAY_MS;
  const recent = before(DAY_MS);
  const prior = before(10 * DAY_MS);
  const clean = (decidedAt: Date): ProposalFixture => ({
    status: 'approved',
    decidedAt,
    replyEditRatio: 0.3,
  });
  const rejected = (decidedAt: Date): ProposalFixture => ({
    status: 'rejected',
    decidedAt,
    rejectCode: 'tone',
    replyEditRatio: 0,
  });

  async function priorShare(
    caseId: string,
    total: number,
    poor: number,
  ): Promise<void> {
    await plantProposals(caseId, total - poor, clean(prior));
    await plantProposals(caseId, poor, rejected(prior));
  }

  async function poorOfEachKind(caseId: string): Promise<void> {
    await plantProposal(caseId, rejected(recent));
    await plantProposal(caseId, { ...clean(recent), replyEditRatio: 0.31 });
    await plantProposal(caseId, {
      ...clean(recent),
      status: 'executed',
      replyEditRatio: 0.5,
    });
    await plantProposal(caseId, {
      ...clean(recent),
      replyEditRatio: 0,
      operatorOverride: true,
    });
  }

  it('tickets at 25% poor against a 10% baseline', async () => {
    const real = await plantCase();
    await priorShare(real, MIN_DECISIONS, 2);
    await poorOfEachKind(real);
    await plantProposal(real, rejected(recent));
    await plantProposals(real, MIN_DECISIONS - 5, clean(recent));

    expect(await rows(query('reply_quality_regression'))).toEqual([
      { decisions: '20', poor: '5', prior_decisions: '20', prior_poor: '2' },
    ]);
  });

  it('puts a decision 7 days old in the prior window and leaves one 35 days old out', async () => {
    const real = await plantCase();
    await priorShare(real, MIN_DECISIONS, 2);
    await poorOfEachKind(real);
    await plantProposal(real, rejected(recent));
    await plantProposals(real, MIN_DECISIONS - 5, clean(recent));
    await plantProposal(real, clean(before(RECENT_WINDOW_MS)));
    await plantProposal(real, rejected(before(LOOKBACK_MS)));

    expect(await rows(query('reply_quality_regression'))).toEqual([
      { decisions: '20', poor: '5', prior_decisions: '21', prior_poor: '2' },
    ]);
  });

  it('stays quiet at exactly 10 points above, an edit ratio of 0.3 not being poor', async () => {
    const real = await plantCase();
    await priorShare(real, MIN_DECISIONS, 2);
    await poorOfEachKind(real);
    await plantProposals(real, MIN_DECISIONS - 4, clean(recent));

    expect(await rows(query('reply_quality_regression'))).toEqual([]);
  });

  it.each([
    ['19 recent decisions', MIN_DECISIONS - 1, MIN_DECISIONS],
    ['19 prior decisions', MIN_DECISIONS, MIN_DECISIONS - 1],
  ])(
    'stays quiet with %s even when every recent one is poor',
    async (_, recentTotal, priorTotal) => {
      const real = await plantCase();
      await priorShare(real, priorTotal, 0);
      await plantProposals(real, recentTotal, rejected(recent));

      expect(await rows(query('reply_quality_regression'))).toEqual([]);
    },
  );

  it('counts no decision on an eval case nor a canary', async () => {
    const real = await plantCase();
    await priorShare(real, MIN_DECISIONS, 2);
    await poorOfEachKind(real);
    await plantProposal(real, rejected(recent));
    await plantProposals(real, MIN_DECISIONS - 6, clean(recent));
    await plantProposal(await plantCase({ source: EVAL }), clean(recent));
    // A canary never reaches `rejected` past the trigger; the query must not rely on it.
    await plantProposal(real, { ...rejected(recent), isCanary: true });

    expect(await rows(query('reply_quality_regression'))).toEqual([]);
  });
});

describe('injection_or_validation_block_rate: > 3× the median of 7 daily shares, n ≥ 10', () => {
  const MIN_RUNS = 10;
  const BASELINE_DAYS = 7;
  const today: RunFixture = { startedAt: before(HOUR_MS) };
  const validation = (startedAt: Date): RunFixture => ({
    startedAt,
    status: 'fallback',
    stopReason: 'validation',
  });

  async function plantDay(
    caseId: string,
    daysAgo: number,
    total: number,
    blocked: number,
  ): Promise<void> {
    const startedAt = before(daysAgo * DAY_MS + HOUR_MS);
    await plantRuns(caseId, total - blocked, { startedAt });
    await plantRuns(caseId, blocked, validation(startedAt));
  }

  async function oneInTenEachDay(caseId: string): Promise<void> {
    for (let day = 1; day <= BASELINE_DAYS; day += 1)
      await plantDay(caseId, day, MIN_RUNS, 1);
  }

  it('tickets at 4 of 10 runs blocked today, by flag or by validation', async () => {
    const real = await plantCase();
    const flagged = await plantCase({ flags: ['injection_signal'] });
    await oneInTenEachDay(real);
    await plantRuns(real, MIN_RUNS - 4, today);
    await plantRuns(real, 2, validation(today.startedAt));
    await plantRuns(flagged, 2, today);

    expect(await rows(query('injection_or_validation_block_rate'))).toEqual([
      { runs: '10', blocked: '4', baseline_share: '0.1000' },
    ]);
  });

  it('counts finished runs only, the kill switch ones included since its scan still flags', async () => {
    const real = await plantCase();
    const flagged = await plantCase({ flags: ['injection_signal'] });
    await oneInTenEachDay(real);
    await plantRuns(real, MIN_RUNS - 4, today);
    await plantRuns(real, 2, validation(today.startedAt));
    await plantRuns(flagged, 2, {
      ...today,
      status: 'fallback',
      stopReason: 'agent_disabled',
    });
    await plantRun(flagged, { ...today, status: 'running', stopReason: null });

    expect(await rows(query('injection_or_validation_block_rate'))).toEqual([
      { runs: '10', blocked: '4', baseline_share: '0.1000' },
    ]);
  });

  it('stays quiet at exactly 3 times the median', async () => {
    const real = await plantCase();
    const flagged = await plantCase({ flags: ['injection_signal'] });
    await oneInTenEachDay(real);
    await plantRuns(real, MIN_RUNS - 3, today);
    await plantRuns(real, 2, validation(today.startedAt));
    await plantRun(flagged, today);

    expect(await rows(query('injection_or_validation_block_rate'))).toEqual([]);
  });

  it('stays quiet at exactly 3 times a median with no finite decimal: 4 of 12 against 1 of 9', async () => {
    const real = await plantCase();
    for (let day = 1; day <= BASELINE_DAYS; day += 1)
      await plantDay(real, day, 9, 1);
    await plantDay(real, 0, 12, 4);

    expect(await rows(query('injection_or_validation_block_rate'))).toEqual([]);
  });

  it.each([
    [6, []],
    [7, [{ runs: '10', blocked: '7', baseline_share: '0.2000' }]],
  ])(
    'with a day without runs, takes the mean of the two middle shares: %i of 10 against 0.2',
    async (blockedToday, expected) => {
      const real = await plantCase();
      for (let day = 1; day <= BASELINE_DAYS - 1; day += 1)
        await plantDay(real, day, MIN_RUNS, day <= 3 ? 1 : 3);
      await plantDay(real, 0, MIN_RUNS, blockedToday);

      expect(await rows(query('injection_or_validation_block_rate'))).toEqual(
        expected,
      );
    },
  );

  it('stays quiet at 9 runs all blocked, a run started 24 hours ago belonging to the day before', async () => {
    const real = await plantCase();
    await oneInTenEachDay(real);
    await plantRuns(real, MIN_RUNS - 1, validation(today.startedAt));
    await plantRun(real, { startedAt: before(DAY_MS) });

    expect(await rows(query('injection_or_validation_block_rate'))).toEqual([]);
  });

  it('stays quiet with no previous day to compare against', async () => {
    const real = await plantCase();
    await plantRuns(real, MIN_RUNS, validation(today.startedAt));

    expect(await rows(query('injection_or_validation_block_rate'))).toEqual([]);
  });

  it('counts no run of an eval or a canary case', async () => {
    const real = await plantCase();
    const flagged = await plantCase({ flags: ['injection_signal'] });
    await oneInTenEachDay(real);
    await plantRuns(real, MIN_RUNS - 5, today);
    await plantRuns(real, 2, validation(today.startedAt));
    await plantRuns(flagged, 2, today);
    await plantRun(await plantCase({ source: EVAL }), today);
    await plantRun(await plantCase({ canary: true }), today);

    expect(await rows(query('injection_or_validation_block_rate'))).toEqual([]);
  });
});

describe('cost_per_case_p95: last 24 h p95 per case > 2× the prior 7 days, n ≥ 20 each', () => {
  const MIN_CASES = 20;
  const RECENT_WINDOW_MS = DAY_MS;
  const LOOKBACK_MS = 8 * DAY_MS;
  const recent = before(HOUR_MS);
  const prior = before(3 * DAY_MS);

  async function cases(
    count: number,
    receivedAt: Date,
    runCosts: string[],
    caseFixture: CaseFixture = {},
  ): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      const caseId = await plantCase({ receivedAt, ...caseFixture });
      for (const costUsd of runCosts)
        await plantRun(caseId, { startedAt: receivedAt, costUsd });
    }
  }

  it('tickets when each recent case, over its two runs, costs 3 times the prior p95', async () => {
    await cases(MIN_CASES, prior, ['0.010000']);
    await cases(MIN_CASES, recent, ['0.015000', '0.015000']);

    expect(await rows(query('cost_per_case_p95'))).toEqual([
      { cases: '20', p95: '0.03', prior_cases: '20', prior_p95: '0.01' },
    ]);
  });

  it('puts a case received 1 day ago in the prior window and leaves one 8 days old out', async () => {
    await cases(MIN_CASES, prior, ['0.010000']);
    await cases(MIN_CASES, recent, ['0.015000', '0.015000']);
    await cases(1, before(RECENT_WINDOW_MS), ['0.010000']);
    await cases(1, before(LOOKBACK_MS), ['0.010000']);

    expect(await rows(query('cost_per_case_p95'))).toEqual([
      { cases: '20', p95: '0.03', prior_cases: '21', prior_p95: '0.01' },
    ]);
  });

  it('stays quiet at exactly twice the prior p95', async () => {
    await cases(MIN_CASES, prior, ['0.010000']);
    await cases(MIN_CASES, recent, ['0.020000']);

    expect(await rows(query('cost_per_case_p95'))).toEqual([]);
  });

  it.each([
    ['19 recent cases', MIN_CASES - 1, MIN_CASES],
    ['19 prior cases', MIN_CASES, MIN_CASES - 1],
  ])('stays quiet with %s', async (_, recentCount, priorCount) => {
    await cases(priorCount, prior, ['0.010000']);
    await cases(recentCount, recent, ['0.030000']);

    expect(await rows(query('cost_per_case_p95'))).toEqual([]);
  });

  it('counts no eval or canary case', async () => {
    await cases(MIN_CASES, prior, ['0.010000']);
    await cases(MIN_CASES - 1, recent, ['0.030000']);
    await cases(1, recent, ['0.030000'], { source: EVAL });
    await cases(1, recent, ['0.030000'], { canary: true });

    expect(await rows(query('cost_per_case_p95'))).toEqual([]);
  });
});

describe('cross_customer_lookup: any security event in the last 15 minutes', () => {
  const WINDOW_MS = 15 * MINUTE_MS;

  async function lookup(at: Date, caseFixture: CaseFixture = {}) {
    const caseId = await plantCase(caseFixture);
    const runId = await plantRun(caseId, { startedAt: before(HOUR_MS) });
    const [event] = await owner<{ id: string }[]>`
      insert into security_events (at, kind, case_id, run_id, ref_masked)
      values (${at}, 'cross_customer_lookup', ${caseId}, ${runId}, 'txn_foreign')
      returning id`;
    return { id: event?.id, caseId, runId, at };
  }

  async function decoys(): Promise<void> {
    await lookup(before(WINDOW_MS));
    await lookup(before(MINUTE_MS), { source: EVAL });
  }

  it('tickets each event of a non-eval case, by id', async () => {
    const { id, caseId, runId, at } = await lookup(before(5 * MINUTE_MS));
    await decoys();

    expect(await rows(query('cross_customer_lookup'))).toEqual([
      { id, case_id: caseId, run_id: runId, at },
    ]);
  });

  it('stays quiet for an event 15 minutes old and for an eval case', async () => {
    await decoys();

    expect(await rows(query('cross_customer_lookup'))).toEqual([]);
  });
});

describe('redactor_degraded: > 5% of intakes over 1 h, n ≥ 20', () => {
  const MIN_INTAKES = 20;
  const recent = before(10 * MINUTE_MS);

  // Each intake also records an injection scan guard step, which must not count as one.
  async function intakes(
    caseId: string,
    count: number,
    outcome: GuardOutcome,
    startedAt = recent,
  ): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      const runId = await plantRun(caseId, { startedAt });
      await owner`
        insert into run_steps (run_id, idx, kind, name, output_masked)
        values (${runId}, 0, 'guard', 'redaction', ${owner.json({ outcome })}),
               (${runId}, 1, 'guard', 'injection_scan', ${owner.json({ outcome: 'passed' })})`;
    }
  }

  it('tickets at 2 of 20 intakes degraded', async () => {
    const real = await plantCase();
    await intakes(real, MIN_INTAKES - 2, 'passed');
    await intakes(real, 2, 'degraded');

    expect(await rows(query('redactor_degraded'))).toEqual([
      { intakes: '20', degraded: '2' },
    ]);
  });

  it('stays quiet at exactly 5%', async () => {
    const real = await plantCase();
    await intakes(real, MIN_INTAKES - 1, 'passed');
    await intakes(real, 1, 'degraded');

    expect(await rows(query('redactor_degraded'))).toEqual([]);
  });

  it('stays quiet at 19 intakes all degraded, a run started an hour ago being outside', async () => {
    const real = await plantCase();
    await intakes(real, MIN_INTAKES - 1, 'degraded');
    await intakes(real, 1, 'passed', before(HOUR_MS));

    expect(await rows(query('redactor_degraded'))).toEqual([]);
  });

  it('counts no intake of an eval or a canary case', async () => {
    const real = await plantCase();
    await intakes(real, MIN_INTAKES - 3, 'passed');
    await intakes(real, 2, 'degraded');
    await intakes(await plantCase({ source: EVAL }), 1, 'passed');
    await intakes(await plantCase({ canary: true }), 1, 'passed');

    expect(await rows(query('redactor_degraded'))).toEqual([]);
  });
});

describe('ops/metrics.sql rejects_by_code (02 G3: an override is wrong_action)', () => {
  const recent = before(DAY_MS);
  const rejectedAs = (
    rejectCode: RejectCode,
    decidedAt = recent,
  ): ProposalFixture => ({ status: 'rejected', rejectCode, decidedAt });
  const overridden = (
    status: Extract<ActionStatus, 'approved' | 'executed' | 'failed'>,
  ): ProposalFixture => ({
    status,
    decidedAt: recent,
    operatorOverride: true,
  });

  async function decisions(): Promise<void> {
    const real = await plantCase();
    await plantProposals(real, 2, rejectedAs('tone'));
    await plantProposal(real, rejectedAs('wrong_category'));
    await plantProposal(real, rejectedAs('wrong_action'));
    await plantProposal(real, overridden('approved'));
    await plantProposal(real, overridden('executed'));
    await plantProposals(real, 2, { status: 'approved', decidedAt: recent });
    await plantProposal(real, rejectedAs('tone', before(8 * DAY_MS)));
    await plantProposal(await plantCase({ source: EVAL }), rejectedAs('tone'));
    // A canary never reaches `rejected` past the trigger; the query must not rely on it.
    await plantProposal(real, { ...rejectedAs('tone'), isCanary: true });
    await plantProposal(real, {
      ...rejectedAs('wrong_action'),
      status: 'canary_caught',
      isCanary: true,
    });
  }

  it('counts rejects per code over the last 7 days, overrides as wrong_action, no canary or eval case', async () => {
    await decisions();

    expect(await rows(query('rejects_by_code', METRICS))).toEqual([
      { code: 'wrong_action', rejects: '3' },
      { code: 'tone', rejects: '2' },
      { code: 'wrong_category', rejects: '1' },
    ]);
  });

  it('takes its window from metrics.window', async () => {
    await decisions();
    await setClock('metrics.window', '30 days');

    expect(await rows(query('rejects_by_code', METRICS))).toEqual([
      { code: 'wrong_action', rejects: '3' },
      { code: 'tone', rejects: '3' },
      { code: 'wrong_category', rejects: '1' },
    ]);
  });
});
