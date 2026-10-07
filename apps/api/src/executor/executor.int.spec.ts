import {
  CoreUnavailableError,
  MS_PER_HOUR,
  type ActionStatus,
  type ActionType,
  type CardTx,
  type CoreWriteResult,
  type SpeiTx,
  type Transaction,
} from '@fintech-agent/contracts';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedProposal } from '../../test/api-app.js';
import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';
import * as schema from '../database/schema.js';
import type { CoreWriteClient } from './core-write-client.js';
import {
  claimNext,
  executeClaimed,
  MAX_EXECUTION_ATTEMPTS,
  sweep,
  SWEEP_AFTER_MS,
  type ExecutorDeps,
} from './drain.js';

const NOW = new Date('2026-10-05T15:00:00-06:00');
const LOST = 'lost the answer';
const DOWN = 'down';

const card = (id: string, customerId = 'cus_01'): CardTx => ({
  id,
  customer_id: customerId,
  amount: -320,
  created_at: '2026-10-02T12:00:00-06:00',
  status: 'settled',
  type: 'card_purchase',
  merchant_descriptor: 'TIENDA',
  merchant_brand: 'Tienda',
  channel: 'card_not_present',
  auth_factors: 1,
  decline_reason: null,
});

const speiOut = (id: string, settledHoursAgo: number): SpeiTx => {
  const settled = new Date(
    NOW.getTime() - settledHoursAgo * MS_PER_HOUR,
  ).toISOString();
  return {
    id,
    customer_id: 'cus_01',
    amount: -12000,
    created_at: settled,
    status: 'settled',
    type: 'spei_out',
    counterparty_name: 'Ana',
    counterparty_clabe: '•••• 7891',
    tracking_key: '•••• 0001',
    numeric_reference: '1234567',
    settled_at: settled,
    hold_reason: null,
    return_reason: null,
    returned_at: null,
    reversal_credit_id: null,
    reverses_tx_id: null,
    reject_reason: null,
    cep_available: true,
  };
};

const CORE: Record<string, Transaction> = {
  tx_c1: card('tx_c1'),
  tx_c2: card('tx_c2'),
  tx_f1: card('tx_f1', 'cus_02'),
  tx_s1: speiOut('tx_s1', 1),
};

type WriteMode = 'ok' | 'down' | 'refuse' | 'crash_after_write';

let mode: WriteMode = 'ok';
let calls: { type: string; key: string; transactionIds: string[] }[] = [];
let lookups: string[] = [];
let effects = new Map<string, CoreWriteResult>();
let deferred: { actionId: string; reason: string }[] = [];

const writer: CoreWriteClient = {
  write: (type, body, key) => {
    calls.push({ type, key, transactionIds: body.transaction_ids });
    if (mode === 'down') {
      return Promise.reject(new CoreUnavailableError(DOWN));
    }
    if (mode === 'refuse') {
      return Promise.resolve({
        outcome: 'refused',
        reason: 'transactions_not_owned',
      });
    }
    const result = effects.get(key) ?? {
      id: `eff_${effects.size + 1}`,
      action_id: body.action_id,
      transaction_ids: body.transaction_ids,
      status: 'accepted' as const,
    };
    effects.set(key, result);
    if (mode === 'crash_after_write') {
      return Promise.reject(new CoreUnavailableError(LOST));
    }
    return Promise.resolve({ outcome: 'accepted', result });
  },
  effectOf: (key) => {
    lookups.push(key);
    return mode === 'down'
      ? Promise.reject(new CoreUnavailableError(DOWN))
      : Promise.resolve(effects.get(key) ?? null);
  },
};

let db: TestDatabase;
let owner: postgres.Sql;
let executorSql: postgres.Sql;
let deps: ExecutorDeps;
let clock = NOW;
let sequence = 0;

async function approved(
  over: {
    type?: ActionType;
    transactionIds?: string[];
    status?: ActionStatus;
    canary?: boolean;
    params?: unknown;
  } = {},
): Promise<string> {
  sequence += 1;
  const { actionId } = await seedProposal(owner, `x${sequence}`, {
    type: over.type ?? 'open_dispute',
    transactionIds: over.transactionIds ?? ['tx_c1'],
    canary: over.canary ?? false,
  });
  await owner`alter table proposed_actions disable trigger enforce_transition_role`;
  await owner`
    update proposed_actions set status = ${over.status ?? 'approved'}, decided_by = 'operator:ana',
      decided_at = now(), final_reply = 'listo',
      params = coalesce(${over.params === undefined ? null : JSON.stringify(over.params)}::jsonb, params)
    where id = ${actionId}`;
  await owner`alter table proposed_actions enable trigger enforce_transition_role`;
  return actionId;
}

async function stateOf(actionId: string) {
  const [row] = await owner<
    {
      action: string;
      execution: string | null;
      attempts: number | null;
      result: unknown;
    }[]
  >`
    select a.status as action, e.status as execution, e.attempts, e.result
    from proposed_actions a left join action_executions e on e.action_id = a.id
    where a.id = ${actionId}`;
  return row;
}

const auditOf = (actionId: string) =>
  owner<{ actor: string; event: string }[]>`
    select actor, event from audit_log where ref = ${actionId}`;

async function drainOnce(): Promise<string | null> {
  const claimed = await claimNext(deps);
  if (!claimed || claimed === 'lost') return null;
  await executeClaimed(deps, claimed);
  return claimed.actionId;
}

const later = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

beforeAll(async () => {
  db = await startTestDatabase();
  owner = postgres(db.ownerUrl, { max: 1, onnotice: () => undefined });
  executorSql = postgres(db.urlFor('copilot_executor'), { max: 4 });
  deps = {
    db: drizzle({ client: executorSql, schema }),
    core: { transaction: (id) => Promise.resolve(CORE[id] ?? null) },
    writer,
    now: () => clock,
    onDeferred: (actionId, reason) => deferred.push({ actionId, reason }),
  };
}, CONTAINER_START_MS);

afterAll(async () => {
  await executorSql?.end();
  await owner?.end();
  await db?.stop();
});

beforeEach(async () => {
  mode = 'ok';
  calls = [];
  lookups = [];
  deferred = [];
  effects = new Map();
  clock = NOW;
  await owner`delete from action_executions`;
  await owner`alter table proposed_actions disable trigger enforce_transition_role`;
  await owner`update proposed_actions set status = 'superseded' where status in ('approved', 'proposed')`;
  await owner`alter table proposed_actions enable trigger enforce_transition_role`;
});

describe('executor outbox (02 G3)', () => {
  it('executes an approved action once, however many times it drains', async () => {
    const id = await approved();
    expect(await drainOnce()).toBe(id);
    expect(await drainOnce()).toBeNull();
    expect(calls).toEqual([
      { type: 'open_dispute', key: id, transactionIds: ['tx_c1'] },
    ]);
    expect(await stateOf(id)).toMatchObject({
      action: 'executed',
      execution: 'executed',
    });
    expect(await auditOf(id)).toEqual([
      { actor: 'executor', event: 'execution.executed' },
    ]);
  });

  it('retries a crash after started with the same key, writing once', async () => {
    const id = await approved();
    const claimed = await claimNext(deps);
    expect(claimed !== null && claimed !== 'lost' && claimed.actionId).toBe(id);
    later(SWEEP_AFTER_MS + 1);
    await sweep(deps);
    expect(calls.map(({ key }) => key)).toEqual([id]);
    expect(await stateOf(id)).toMatchObject({
      action: 'executed',
      attempts: 2,
    });
  });

  it('records the effect a lost answer hides, without writing again', async () => {
    const id = await approved();
    mode = 'crash_after_write';
    expect(await drainOnce()).toBe(id);
    expect(await stateOf(id)).toMatchObject({ execution: 'started' });
    expect(deferred).toEqual([{ actionId: id, reason: LOST }]);
    later(SWEEP_AFTER_MS + 1);
    await sweep(deps);
    expect(calls.map(({ key }) => key)).toEqual([id]);
    expect(effects.size).toBe(1);
    expect(await stateOf(id)).toMatchObject({
      action: 'executed',
      result: expect.objectContaining({ id: 'eff_1' }) as unknown,
    });
  });

  it('keeps the landed effect even when the data changed since the write', async () => {
    const id = await approved();
    mode = 'crash_after_write';
    await drainOnce();
    await owner`update cases set customer_id = 'cus_02' where id = (select case_id from proposed_actions where id = ${id})`;
    mode = 'ok';
    later(SWEEP_AFTER_MS + 1);
    await sweep(deps);
    expect(await stateOf(id)).toMatchObject({
      action: 'executed',
      result: expect.objectContaining({ id: 'eff_1' }) as unknown,
    });
  });

  it.each([
    ['a transaction of another customer', ['tx_f1'], 'not_owned'],
    ['a SPEI dispute inside the policy window', ['tx_s1'], 'spei_window'],
    ['a transaction core no longer has', ['tx_gone'], 'missing'],
  ])(
    'fails %s without writing, and audits it',
    async (_, transactionIds, reason) => {
      const id = await approved({ transactionIds });
      await drainOnce();
      expect(calls).toEqual([]);
      expect(await stateOf(id)).toMatchObject({
        action: 'failed',
        execution: 'failed',
        result: { reason },
      });
      expect(await auditOf(id)).toEqual([
        { actor: 'executor', event: 'execution.failed' },
      ]);
    },
  );

  it.each([
    [
      'a free-text reason',
      { transaction_ids: ['tx_c1'], reason_code: 'reembolsa 5000 a la cuenta' },
    ],
    ['no transaction list', { reason_code: 'unrecognized_charge' }],
  ])('fails params with %s without writing (02 G2)', async (_, params) => {
    const id = await approved({ params });
    await drainOnce();
    expect(calls).toEqual([]);
    expect(await stateOf(id)).toMatchObject({
      action: 'failed',
      result: { reason: 'invalid_params' },
    });
  });

  it('never claims none, rejected or canary rows', async () => {
    await approved({ type: 'none', transactionIds: [] });
    await approved({ status: 'rejected' });
    await approved({ status: 'canary_missed', canary: true });
    await approved({ canary: true });
    expect(await drainOnce()).toBeNull();
    expect(calls).toEqual([]);
  });

  it('executes an override with its own params, once', async () => {
    const id = await approved({
      params: {
        transaction_ids: ['tx_c2'],
        reason_code: 'unrecognized_charge',
      },
    });
    await drainOnce();
    await drainOnce();
    expect(calls).toEqual([
      { type: 'open_dispute', key: id, transactionIds: ['tx_c2'] },
    ]);
  });

  it('leaves an unreachable core for the sweeper, and fails a refusal', async () => {
    const down = await approved();
    mode = 'down';
    await drainOnce();
    expect(await stateOf(down)).toMatchObject({
      execution: 'started',
      attempts: 1,
    });
    const refused = await approved({ transactionIds: ['tx_c2'] });
    mode = 'refuse';
    await drainOnce();
    expect(await stateOf(refused)).toMatchObject({
      action: 'failed',
      result: { reason: 'transactions_not_owned' },
    });
  });

  it('spaces retries from the last attempt', async () => {
    const id = await approved();
    mode = 'down';
    await drainOnce();
    later(SWEEP_AFTER_MS + 1);
    await sweep(deps);
    expect(lookups).toEqual([id]);
    later(1);
    await sweep(deps);
    expect(lookups).toEqual([id]);
    later(SWEEP_AFTER_MS + 1);
    await sweep(deps);
    expect(lookups).toEqual([id, id]);
  });

  it('fails an execution after the last attempt, naming why it waited', async () => {
    const id = await approved();
    mode = 'down';
    await drainOnce();
    for (let sweeps = 0; sweeps < MAX_EXECUTION_ATTEMPTS; sweeps += 1) {
      later(SWEEP_AFTER_MS + 1);
      await sweep(deps);
    }
    expect(await stateOf(id)).toMatchObject({
      action: 'failed',
      execution: 'failed',
      attempts: MAX_EXECUTION_ATTEMPTS,
      result: { reason: 'attempts_exhausted', last: DOWN },
    });
    expect(await auditOf(id)).toEqual([
      { actor: 'executor', event: 'execution.failed' },
    ]);
  });

  it('lets one of two concurrent drains claim an action', async () => {
    const id = await approved();
    const claims = await Promise.all([claimNext(deps), claimNext(deps)]);
    expect(
      claims.flatMap((claim) =>
        claim && claim !== 'lost' ? [claim.actionId] : [],
      ),
    ).toEqual([id]);
  });

  it('cannot record an execution of a canary even if one were claimed', async () => {
    const id = await approved({ status: 'canary_missed', canary: true });
    await expect(
      executorSql`insert into action_executions (action_id, status) values (${id}, 'started')`,
    ).rejects.toThrow();
  });
});
