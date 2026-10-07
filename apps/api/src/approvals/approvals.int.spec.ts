import * as contracts from '@fintech-agent/contracts';
import {
  CoreUnavailableError,
  type CardTx,
  type CaseFlag,
  type CoreClient,
  type Transaction,
} from '@fintech-agent/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';
import { AppModule } from '../app.module.js';
import { CORE_CLIENT } from './approvals.module.js';

const ANA = 'dev-operator-ana-token-0123456789';
const BETO = 'dev-operator-beto-token-0123456789';
const OPERATOR_TOKENS = `ana:k1:${ANA},beto:k2:${BETO}`;
const USER_AGENT = 'console-test/1.0';
const DRAFT = 'Hola Ana, registramos tu aclaración con folio {{folio}}.';
const FINAL = 'Hola Ana, registramos tu aclaración. Te escribimos pronto.';
const STATUS = {
  ok: 200,
  badRequest: 400,
  unauthorized: 401,
  notFound: 404,
  conflict: 409,
  unavailable: 503,
} as const;

const card = (id: string, customerId: string): CardTx => ({
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

const CORE: Record<string, Transaction> = {
  tx_c1: card('tx_c1', 'cus_01'),
  tx_c2: card('tx_c2', 'cus_01'),
  tx_f1: card('tx_f1', 'cus_02'),
};

let coreDown = false;
const fakeCore: CoreClient = {
  customer: () => Promise.resolve(null),
  transactions: () => Promise.resolve(null),
  transaction: (id) =>
    coreDown
      ? Promise.reject(new CoreUnavailableError('down'))
      : Promise.resolve(CORE[id] ?? null),
};

let db: TestDatabase;
let owner: postgres.Sql;
let app: INestApplication;
let base: string;
let sequence = 0;

interface Fixture {
  flags?: CaseFlag[];
  tier?: 'standard' | 'high';
  canary?: boolean;
  type?: contracts.ActionType;
  transactionIds?: string[];
  caseStatus?: contracts.CaseStatus;
}

async function proposal(fixture: Fixture = {}): Promise<string> {
  sequence += 1;
  const caseId = `case_d${sequence}`;
  const runId = `run_d${sequence}`;
  const actionId = `act_d${sequence}`;
  const params = {
    transaction_ids: fixture.transactionIds ?? ['tx_c1'],
    reason_code: 'unrecognized_charge',
  };
  await owner`
    insert into cases (id, ticket_id, folio, received_at, source, customer_id, text_masked, status, flags, review_tier, category)
    values (${caseId}, ${`T-${caseId}`}, ${`AC-D${String(sequence).padStart(3, '0')}-TEST`}, now(), 'webhook', 'cus_01', 'hola',
      ${fixture.caseStatus ?? 'needs_review'}, ${owner.json(fixture.flags ?? [])}, ${fixture.tier ?? 'standard'}, 'unrecognized_card_charge')`;
  await owner`
    insert into agent_runs (id, case_id, variant, model, prompt_version)
    values (${runId}, ${caseId}, 'v1', 'model', 'p1')`;
  await owner`
    insert into resolutions (run_id, category, draft_reply, citations, abstained, reasoning_summary)
    values (${runId}, 'unrecognized_card_charge', ${DRAFT}, '[]', false, 'x')`;
  await owner`
    insert into proposed_actions (id, case_id, run_id, agent_type, agent_params, type, params, justification, is_canary)
    values (${actionId}, ${caseId}, ${runId}, ${fixture.type ?? 'open_dispute'}, ${owner.json(params)},
      ${fixture.type ?? 'open_dispute'}, ${owner.json(params)}, 'x', ${fixture.canary ?? false})`;
  return actionId;
}

function decide(
  actionId: string,
  body: Record<string, unknown>,
  token: string | null = ANA,
): Promise<Response> {
  return fetch(`${base}/actions/${actionId}/decision`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

const approve = (over: Record<string, unknown> = {}) => ({
  decision: 'approve',
  final_reply: FINAL,
  acknowledged_flags: [],
  reviewed_transaction_ids: [],
  ...over,
});

const reject = (over: Record<string, unknown> = {}) => ({
  decision: 'reject',
  final_reply: FINAL,
  acknowledged_flags: [],
  reject_code: 'wrong_action',
  ...over,
});

async function actionRow(id: string) {
  const [row] = await owner<
    {
      status: string;
      type: string;
      params: unknown;
      agent_type: string;
      agent_params: unknown;
      operator_override: boolean;
      decided_by: string | null;
      final_reply: string | null;
      reply_edit_ratio: number | null;
      case_status: string;
    }[]
  >`
    select a.status, a.type, a.params, a.agent_type, a.agent_params, a.operator_override,
      a.decided_by, a.final_reply, a.reply_edit_ratio, c.status as case_status
    from proposed_actions a join cases c on c.id = a.case_id where a.id = ${id}`;
  return row;
}

const auditRows = (ref: string) =>
  owner<
    {
      actor: string;
      event: string;
      key_id: string | null;
      ip: string | null;
      user_agent: string | null;
      detail_masked: Record<string, unknown>;
    }[]
  >`select actor, event, key_id, ip, user_agent, detail_masked from audit_log where ref = ${ref} order by id`;

beforeAll(async () => {
  db = await startTestDatabase();
  owner = postgres(db.ownerUrl, { max: 1, onnotice: () => undefined });
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule.register({
        API_DATABASE_URL: db.urlFor('copilot_api'),
        API_PORT: 0,
        OPERATOR_TOKENS,
        CORE_MOCK_URL: 'http://core-mock.invalid',
        CORE_READ_KEY: 'unused-in-tests',
      }),
    ],
  })
    .overrideProvider(CORE_CLIENT)
    .useValue(fakeCore)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
}, CONTAINER_START_MS);

afterAll(async () => {
  await app?.close();
  await owner?.end();
  await db?.stop();
});

beforeEach(() => {
  coreDown = false;
});

describe('approval gate (02 G3)', () => {
  it('approves: stores the final reply and its edit ratio, resolves the case, audits the operator', async () => {
    const id = await proposal();
    const response = await decide(
      id,
      approve({ reviewed_transaction_ids: [] }),
    );
    expect(response.status).toBe(STATUS.ok);
    expect(await response.json()).toEqual({
      action_id: id,
      status: 'approved',
    });
    const row = await actionRow(id);
    expect(row).toMatchObject({
      status: 'approved',
      decided_by: 'operator:ana',
      final_reply: FINAL,
      case_status: 'resolved',
      operator_override: false,
    });
    expect(row?.reply_edit_ratio).toBeGreaterThan(0);
    expect(await auditRows(id)).toEqual([
      expect.objectContaining({
        actor: 'operator:ana',
        event: 'decision.approve',
        key_id: 'k1',
        ip: expect.stringMatching(/127\.0\.0\.1/) as unknown,
        user_agent: USER_AGENT,
      }),
    ]);
  });

  it('rejects: stores the final reply and the code, resolves the case', async () => {
    const id = await proposal();
    const response = await decide(id, reject(), BETO);
    expect(response.status).toBe(STATUS.ok);
    expect(await actionRow(id)).toMatchObject({
      status: 'rejected',
      decided_by: 'operator:beto',
      final_reply: FINAL,
      case_status: 'resolved',
    });
    expect(await auditRows(id)).toEqual([
      expect.objectContaining({ event: 'decision.reject', key_id: 'k2' }),
    ]);
  });

  it('answers 409 to a second decision and audits only the first', async () => {
    const id = await proposal();
    expect((await decide(id, approve())).status).toBe(STATUS.ok);
    expect((await decide(id, approve())).status).toBe(STATUS.conflict);
    expect((await decide(id, reject())).status).toBe(STATUS.conflict);
    expect(await auditRows(id)).toHaveLength(1);
  });

  it('lets exactly one of two concurrent approvals through', async () => {
    const id = await proposal();
    const statuses = await Promise.all([
      decide(id, approve()),
      decide(id, approve(), BETO),
    ]).then((responses) => responses.map(({ status }) => status).sort());
    expect(statuses).toEqual([STATUS.ok, STATUS.conflict]);
    expect(await auditRows(id)).toHaveLength(1);
  });

  it('answers 404 for an unknown action', async () => {
    expect((await decide('act_nope', approve())).status).toBe(STATUS.notFound);
  });

  it('answers 409 when the case is not waiting for review', async () => {
    const id = await proposal({ caseStatus: 'investigating' });
    expect((await decide(id, approve())).status).toBe(STATUS.conflict);
    expect((await actionRow(id))?.status).toBe('proposed');
  });

  it('never creates an execution for a rejection or a none action', async () => {
    const rejected = await proposal();
    const none = await proposal({ type: 'none', transactionIds: [] });
    expect((await decide(rejected, reject())).status).toBe(STATUS.ok);
    expect((await decide(none, approve())).status).toBe(STATUS.ok);
    expect((await actionRow(none))?.final_reply).toBe(FINAL);
    const [row] = await owner<{ count: string }[]>`
      select count(*) from action_executions where action_id in (${rejected}, ${none})`;
    expect(row?.count).toBe('0');
  });

  it.each([
    ['a full CLABE', `${FINAL} Tu CLABE 012180001234567891.`, 'PII_IN_REPLY'],
    ['a link', `${FINAL} Entra a https://evil.example/x`, 'LINK_IN_REPLY'],
    ['a CVV request', `${FINAL} Confírmanos tu CVV.`, 'AUTH_FACTOR_REQUEST'],
  ])('refuses a final reply with %s', async (_, finalReply, code) => {
    const id = await proposal();
    const response = await decide(id, approve({ final_reply: finalReply }));
    expect(response.status).toBe(STATUS.badRequest);
    expect(await response.json()).toMatchObject({ codes: [code] });
    expect((await actionRow(id))?.status).toBe('proposed');
  });
});

describe('reject reason (02 G6)', () => {
  it('refuses a reject reason carrying PII and leaves the proposal open', async () => {
    const id = await proposal();
    const response = await decide(
      id,
      reject({ reject_reason: 'el cliente dio su CLABE 012180001234567891' }),
    );
    expect(response.status).toBe(STATUS.badRequest);
    expect(await response.text()).not.toContain('012180001234567891');
    expect((await actionRow(id))?.status).toBe('proposed');
  });
});

describe('operator identity (02 G3)', () => {
  it.each([
    ['no token', null],
    ['an unknown token', 'dev-operator-eve-token-0123456789'],
  ])('answers 401 with %s', async (_, token) => {
    const id = await proposal();
    const response = await decide(id, approve(), token);
    expect(response.status).toBe(STATUS.unauthorized);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('answers 400 to a body that names an operator', async () => {
    const id = await proposal();
    const response = await decide(id, approve({ operator: 'operator:beto' }));
    expect(response.status).toBe(STATUS.badRequest);
    expect((await actionRow(id))?.status).toBe('proposed');
  });
});

describe('override and forcing function (02 G3)', () => {
  const override = (type: string, ids: string[]) => ({
    override: {
      type,
      transaction_ids: ids,
      reason_code: 'unrecognized_charge',
    },
    reviewed_transaction_ids: ids,
  });

  it('applies a valid override and keeps the agent proposal', async () => {
    const id = await proposal({ type: 'none', transactionIds: [] });
    const response = await decide(
      id,
      approve(override('open_dispute', ['tx_c1', 'tx_c2'])),
    );
    expect(response.status).toBe(STATUS.ok);
    expect(await actionRow(id)).toMatchObject({
      status: 'approved',
      type: 'open_dispute',
      params: {
        transaction_ids: ['tx_c1', 'tx_c2'],
        reason_code: 'unrecognized_charge',
      },
      agent_type: 'none',
      agent_params: { transaction_ids: [], reason_code: 'unrecognized_charge' },
      operator_override: true,
    });
  });

  it('records no override when the operator picks the agent action again', async () => {
    const id = await proposal({ transactionIds: ['tx_c1', 'tx_c2'] });
    const response = await decide(
      id,
      approve(override('open_dispute', ['tx_c1', 'tx_c2'])),
    );
    expect(response.status).toBe(STATUS.ok);
    expect((await actionRow(id))?.operator_override).toBe(false);
  });

  it('records an override when only the order of the transactions changes', async () => {
    const id = await proposal({ transactionIds: ['tx_c1', 'tx_c2'] });
    const response = await decide(
      id,
      approve(override('open_dispute', ['tx_c2', 'tx_c1'])),
    );
    expect(response.status).toBe(STATUS.ok);
    expect((await actionRow(id))?.operator_override).toBe(true);
  });

  it('answers the same 400 for a foreign and a missing transaction', async () => {
    const foreign = await proposal();
    const missing = await proposal();
    const a = await decide(
      foreign,
      approve(override('open_dispute', ['tx_f1'])),
    );
    const b = await decide(
      missing,
      approve(override('open_dispute', ['tx_zz9'])),
    );
    expect([a.status, b.status]).toEqual([
      STATUS.badRequest,
      STATUS.badRequest,
    ]);
    expect(await a.json()).toEqual(await b.json());
  });

  it('refuses an override outside the G2 table', async () => {
    const id = await proposal();
    const response = await decide(
      id,
      approve(override('resend_cep', ['tx_c1', 'tx_c2'])),
    );
    expect(response.status).toBe(STATUS.badRequest);
  });

  it('refuses an override on a standard case without the check-off', async () => {
    const id = await proposal();
    const response = await decide(
      id,
      approve({
        ...override('open_dispute', ['tx_c2']),
        reviewed_transaction_ids: [],
      }),
    );
    expect(response.status).toBe(STATUS.badRequest);
  });

  it('requires the check-off on a high-tier case, as a set', async () => {
    const id = await proposal({
      tier: 'high',
      transactionIds: ['tx_c1', 'tx_c2'],
    });
    expect(
      (await decide(id, approve({ reviewed_transaction_ids: ['tx_c1'] })))
        .status,
    ).toBe(STATUS.badRequest);
    expect(
      (
        await decide(
          id,
          approve({ reviewed_transaction_ids: ['tx_c2', 'tx_c1', 'tx_c1'] }),
        )
      ).status,
    ).toBe(STATUS.ok);
  });

  it('answers 503 and leaves the proposal open when core-mock is down', async () => {
    coreDown = true;
    const id = await proposal();
    const response = await decide(
      id,
      approve(override('open_dispute', ['tx_c2'])),
    );
    expect(response.status).toBe(STATUS.unavailable);
    expect((await actionRow(id))?.status).toBe('proposed');
  });
});

describe('flag acknowledgment (02 G3)', () => {
  const flags: CaseFlag[] = ['injection_signal', 'action_fact_mismatch'];

  it.each([
    ['none', []],
    ['a subset', ['injection_signal']],
    ['a superset', [...flags, 'fallback']],
  ])('refuses an approval acknowledging %s', async (_, acknowledged) => {
    const id = await proposal({ flags });
    const response = await decide(
      id,
      approve({ acknowledged_flags: acknowledged }),
    );
    expect(response.status).toBe(STATUS.badRequest);
  });

  it('approves with the flags in any order and audits the acknowledgment', async () => {
    const id = await proposal({ flags });
    const response = await decide(
      id,
      approve({ acknowledged_flags: [...flags].reverse() }),
    );
    expect(response.status).toBe(STATUS.ok);
    const [audit] = await auditRows(id);
    expect(audit?.detail_masked.acknowledged_flags).toEqual(
      expect.arrayContaining(flags),
    );
  });
});

describe('canaries (02 G3)', () => {
  it('marks an approved canary missed and a rejected one caught, with no execution', async () => {
    const missed = await proposal({ canary: true });
    const caught = await proposal({ canary: true });
    const approved = await decide(missed, approve());
    const rejected = await decide(caught, reject());
    expect(await approved.json()).toEqual({
      action_id: missed,
      status: 'canary_missed',
    });
    expect(await rejected.json()).toEqual({
      action_id: caught,
      status: 'canary_caught',
    });
    const [row] = await owner<{ count: string }[]>`
      select count(*) from action_executions where action_id in (${missed}, ${caught})`;
    expect(row?.count).toBe('0');
  });

  it('exposes is_canary in no contracts schema', () => {
    const schemas = Object.values(contracts as Record<string, unknown>).filter(
      (value): value is z.ZodType => value instanceof z.ZodType,
    );
    expect(schemas.length).toBeGreaterThan(0);
    for (const schema of schemas) {
      expect(
        JSON.stringify(z.toJSONSchema(schema, { unrepresentable: 'any' })),
      ).not.toContain('is_canary');
    }
  });
});
