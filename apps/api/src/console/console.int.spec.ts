import {
  CaseDetailSchema,
  CoreUnavailableError,
  InboxItemSchema,
  type CardTx,
  type CaseDetail,
  type CoreClient,
  type SpeiTx,
} from '@fintech-agent/contracts';
import type { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ANA, HTTP, seedProposal, startApiApp } from '../../test/api-app.js';
import { keyPathsOf } from '../../test/key-paths.js';
import {
  CONTAINER_START_MS,
  insertCase,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';

const CUSTOMER_OPTIONS = [
  { id: 'cus_01', first_name: 'Ana' },
  { id: 'cus_02', first_name: 'Luis' },
];
const CLABE = '072180009876543213';
const cardCharge: CardTx = {
  id: 'tx_c1',
  customer_id: 'cus_01',
  type: 'card_purchase',
  status: 'settled',
  amount: 899,
  created_at: '2026-10-03T22:10:00-06:00',
  merchant_descriptor: 'PAYPAL *DIGITALGOODS',
  merchant_brand: 'Digital Goods Ltd',
  channel: 'card_not_present',
  auth_factors: 1,
  decline_reason: null,
};
const speiOut: SpeiTx = {
  id: 'tx_s1',
  customer_id: 'cus_01',
  type: 'spei_out',
  status: 'settled',
  amount: 12000,
  created_at: '2026-10-02T11:20:00-06:00',
  counterparty_name: 'María Fernanda López Ruiz',
  counterparty_clabe: CLABE,
  tracking_key: 'BNET20261002SO2A',
  numeric_reference: '1005261',
  settled_at: '2026-10-02T11:20:04-06:00',
  hold_reason: null,
  return_reason: null,
  returned_at: null,
  reversal_credit_id: null,
  reverses_tx_id: null,
  reject_reason: null,
  cep_available: true,
};

let coreDown = false;
const answerOrDown = <T>(value: T): Promise<T> =>
  coreDown
    ? Promise.reject(new CoreUnavailableError('down'))
    : Promise.resolve(value);
const olderCharge: CardTx = {
  ...cardCharge,
  id: 'tx_old1',
  created_at: '2026-08-01T09:00:00-06:00',
};
const foreignCharge: CardTx = {
  ...cardCharge,
  id: 'tx_foreign1',
  customer_id: 'cus_02',
};
const OUTSIDE_THE_PAGE = new Map(
  [olderCharge, foreignCharge].map((tx) => [tx.id, tx]),
);
const UNKNOWN_CUSTOMER = 'cus_nobody';
let lastQuery: URLSearchParams | undefined;
const core: CoreClient = {
  customer: () => Promise.resolve(null),
  customerOptions: () => answerOrDown(CUSTOMER_OPTIONS),
  transaction: (id) => answerOrDown(OUTSIDE_THE_PAGE.get(id) ?? null),
  transactions: (customerId, query) => {
    lastQuery = query;
    return answerOrDown(
      customerId === UNKNOWN_CUSTOMER
        ? null
        : { items: [cardCharge, speiOut], total: 2, next_cursor: null },
    );
  },
};

let testDb: TestDatabase;
let owner: postgres.Sql;
let app: INestApplication;
let base: string;

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 2, onnotice: () => undefined });
  ({ app, base } = await startApiApp(testDb, core));
}, CONTAINER_START_MS);

afterAll(async () => {
  await app?.close();
  await owner?.end();
  await testDb?.stop();
});

const get = (path: string, token: string | null = ANA) =>
  fetch(`${base}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

const decide = (actionId: string, body: Record<string, unknown>) =>
  fetch(`${base}/actions/${actionId}/decision`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${ANA}`,
    },
    body: JSON.stringify(body),
  });

const REJECT = {
  decision: 'reject',
  final_reply: 'Hola, revisamos tu caso y te escribimos pronto.',
  acknowledged_flags: [],
  reject_code: 'wrong_action',
};

const rerun = (caseId: string) =>
  fetch(`${base}/cases/${caseId}/rerun`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ANA}` },
  });

const detailOf = async (caseId: string): Promise<CaseDetail> => {
  const response = await get(`/cases/${caseId}`);
  expect(response.status).toBe(HTTP.ok);
  return CaseDetailSchema.parse(await response.json());
};

describe('console read API (04 Step 7, 02 G3)', () => {
  it.each(['/me', '/status', '/customers', '/cases', '/cases/case_abc'])(
    'refuses GET %s without an operator token',
    async (path) => {
      expect((await get(path, null)).status).toBe(HTTP.unauthorized);
    },
  );

  it('names the signed-in operator', async () => {
    expect(await (await get('/me')).json()).toEqual({ id: 'ana' });
  });

  it('reports an agent without an API key as no_api_key', async () => {
    expect(await (await get('/status')).json()).toEqual({
      agent: 'no_api_key',
    });
  });

  it('lists the customers by first name for the new case form', async () => {
    expect(await (await get('/customers')).json()).toEqual(CUSTOMER_OPTIONS);
  });

  it('answers 503 for the customer list while core-mock is down', async () => {
    coreDown = true;
    try {
      const response = await get('/customers');
      expect(response.status).toBe(HTTP.unavailable);
      expect(await response.json()).toEqual({ message: 'core_unavailable' });
    } finally {
      coreDown = false;
    }
  });

  it('lists open work by review tier then newest, decided cases last, and hides eval cases unless asked', async () => {
    await seedProposal(owner, 'inboxhigh', { tier: 'high' });
    await seedProposal(owner, 'inboxstd', { tier: 'standard' });
    await insertCase(owner, 'case_inboxqueued');
    await owner`
      update cases set received_at = received_at - interval '1 hour'
      where id = 'case_inboxhigh'`;
    const resolved = await seedProposal(owner, 'inboxdone', { tier: 'high' });
    expect((await decide(resolved.actionId, REJECT)).status).toBe(HTTP.ok);
    await insertCase(owner, 'case_inboxeval');
    await owner`update cases set source = 'eval' where id = 'case_inboxeval'`;

    const inbox = InboxItemSchema.array().parse(
      await (await get('/cases')).json(),
    );
    const ids = inbox.map(({ case_id }) => case_id);
    expect(ids.indexOf('case_inboxhigh')).toBeLessThan(
      ids.indexOf('case_inboxqueued'),
    );
    expect(ids.indexOf('case_inboxqueued')).toBeLessThan(
      ids.indexOf('case_inboxstd'),
    );
    expect(ids.indexOf('case_inboxstd')).toBeLessThan(
      ids.indexOf('case_inboxdone'),
    );
    expect(ids).toContain('case_inboxstd');
    expect(ids).not.toContain('case_inboxeval');
    const withEval = InboxItemSchema.array().parse(
      await (await get('/cases?include_eval=true')).json(),
    );
    expect(withEval.map(({ case_id }) => case_id)).toContain('case_inboxeval');
  });

  it('refuses an unknown inbox parameter value with 400', async () => {
    expect((await get('/cases?include_eval=maybe')).status).toBe(
      HTTP.badRequest,
    );
  });

  it('shows a case with its run trace, resolution, open proposal and override options', async () => {
    const { caseId, actionId } = await seedProposal(owner, 'detail', {
      flags: ['action_fact_mismatch'],
      tier: 'high',
    });
    await owner`
      insert into run_steps (run_id, idx, kind, name, input_masked, output_masked, latency_ms, cost_usd)
      values ('run_detail', 0, 'tool', 'list_transactions', ${owner.json({ limit: 10 })},
        ${owner.json({ items: [{ id: 'tx_c1' }] })}, 120, null),
        ('run_detail', 1, 'llm', 'investigate', null, null, 900, '0.001200')`;

    const detail = await detailOf(caseId);
    expect(detail.case).toMatchObject({
      case_id: caseId,
      status: 'needs_review',
      review_tier: 'high',
      flags: ['action_fact_mismatch'],
      text: 'hola',
    });
    expect(detail.runs).toHaveLength(1);
    expect(detail.runs[0]?.steps.map(({ idx, name }) => [idx, name])).toEqual([
      [0, 'list_transactions'],
      [1, 'investigate'],
    ]);
    expect(detail.resolution?.draft_reply).toContain('{{folio}}');
    expect(detail.proposal).toMatchObject({
      action_id: actionId,
      type: 'open_dispute',
      status: 'proposed',
    });
    const dispute = detail.override_options?.actions.find(
      ({ type }) => type === 'open_dispute',
    );
    expect(dispute?.transaction_ids).toEqual(['tx_c1', 'tx_s1']);
    expect(detail.override_options?.transactions.map(({ id }) => id)).toEqual([
      'tx_c1',
      'tx_s1',
    ]);
  });

  it('shows the customer transactions masked, as the model sees them (02 G6)', async () => {
    const { caseId } = await seedProposal(owner, 'masked');
    const text = await (await get(`/cases/${caseId}`)).text();
    expect(text).not.toContain(CLABE);
    expect(text).not.toContain(speiOut.counterparty_name);
    expect(text).not.toMatch(/\d{8,}/);
  });

  it('serves no override options while core-mock is down, and the rest of the case', async () => {
    const { caseId } = await seedProposal(owner, 'coredown');
    coreDown = true;
    try {
      const detail = await detailOf(caseId);
      expect(detail.override_options).toBeNull();
      expect(detail.proposal?.status).toBe('proposed');
    } finally {
      coreDown = false;
    }
  });

  it('offers no override once the proposal is decided', async () => {
    const { caseId, actionId } = await seedProposal(owner, 'decided');
    const decided = await decide(actionId, REJECT);
    expect(decided.status).toBe(HTTP.ok);
    const detail = await detailOf(caseId);
    expect(detail.proposal?.status).toBe('rejected');
    expect(detail.override_options).toBeNull();
  });

  it('shows only the redacted case text, never the masked one (02 G6)', async () => {
    const { caseId } = await seedProposal(owner, 'redacted');
    await owner`
      update cases set text_masked = 'mi contraseña es girasol',
        text_redacted = 'mi contraseña es [dato]'
      where id = ${caseId}`;
    const text = await (await get(`/cases/${caseId}`)).text();
    expect(CaseDetailSchema.parse(JSON.parse(text)).case.text).toBe(
      'mi contraseña es [dato]',
    );
    expect(text).not.toContain('girasol');
  });

  it('shows no case text before the redactor has run', async () => {
    await insertCase(owner, 'case_notyetread');
    expect((await detailOf('case_notyetread')).case.text).toBeNull();
  });

  it('shows every run in order with its own steps, and the latest run proposal and resolution', async () => {
    const { caseId } = await seedProposal(owner, 'rerun');
    await owner`
      insert into run_steps (run_id, idx, kind, name, input_masked)
      values ('run_rerun', 0, 'tool', 'list_transactions', ${owner.json({ reference: '12345678901' })})`;
    expect((await rerun(caseId)).status).toBe(HTTP.ok);
    await owner`
      insert into agent_runs (id, case_id, variant, model, prompt_version, started_at)
      values ('run_rerunb', ${caseId}, 'v1', 'model', 'p1', now() + interval '1 second')`;
    await owner`
      insert into run_steps (run_id, idx, kind, name)
      values ('run_rerunb', 0, 'retrieval', 'search_policies')`;
    await owner`
      insert into resolutions (run_id, category, draft_reply, citations, abstained, reasoning_summary)
      values ('run_rerunb', 'unrecognized_card_charge', 'Segunda respuesta.', '[]', false, 'y')`;
    await owner`
      insert into proposed_actions (id, case_id, run_id, agent_type, agent_params, type, params, justification, proposed_at)
      values ('act_rerunb', ${caseId}, 'run_rerunb', 'none', ${owner.json({ transaction_ids: [], reason_code: 'informational' })},
        'none', ${owner.json({ transaction_ids: [], reason_code: 'informational' })}, 'y', now() + interval '1 second')`;

    const text = await (await get(`/cases/${caseId}`)).text();
    expect(text).not.toContain('12345678901');
    const detail = CaseDetailSchema.parse(JSON.parse(text));
    expect(
      detail.runs.map(({ run_id, steps }) => [
        run_id,
        steps.map(({ name }) => name),
      ]),
    ).toEqual([
      ['run_rerun', ['list_transactions']],
      ['run_rerunb', ['search_policies']],
    ]);
    expect(detail.proposal?.action_id).toBe('act_rerunb');
    expect(detail.resolution?.draft_reply).toBe('Segunda respuesta.');
  });

  it('asks core-mock for a full page of the customer transactions', async () => {
    const { caseId } = await seedProposal(owner, 'pagesize');
    await detailOf(caseId);
    expect(lastQuery?.get('limit')).toBe('25');
  });

  it('offers the proposal own transactions even when they fall outside the page, and never a foreign one', async () => {
    const { caseId } = await seedProposal(owner, 'oldtx', {
      transactionIds: ['tx_old1', 'tx_foreign1'],
    });
    const options = (await detailOf(caseId)).override_options;
    expect(options?.transactions.map(({ id }) => id)).toEqual([
      'tx_c1',
      'tx_s1',
      'tx_old1',
    ]);
    expect(
      options?.actions.find(({ type }) => type === 'open_dispute')
        ?.transaction_ids,
    ).toContain('tx_old1');
  });

  it('serves no override options for a customer core-mock does not know', async () => {
    const { caseId } = await seedProposal(owner, 'nocustomer');
    await owner`update cases set customer_id = ${UNKNOWN_CUSTOMER} where id = ${caseId}`;
    expect((await detailOf(caseId)).override_options).toBeNull();
  });

  it('answers 404 for an unknown case and 400 for a malformed id', async () => {
    expect((await get('/cases/case_nosuchcase')).status).toBe(HTTP.notFound);
    expect((await get('/cases/not-a-case')).status).toBe(HTTP.badRequest);
  });

  it('serializes a canary proposal like a real one until it is decided (02 G3)', async () => {
    const citations = owner.json([
      {
        chunk_id: 'chunk_p04s2',
        doc_id: 'pol-04',
        section: 'Cargos no reconocidos',
        quote: 'Puedes objetar un cargo no reconocido.',
      },
    ]);
    const seen = async (key: string, canary: boolean) => {
      const seeded = await seedProposal(owner, key, {
        flags: ['action_fact_mismatch'],
        tier: 'high',
        canary,
      });
      await owner`
        update agent_runs set status = 'succeeded', stop_reason = 'completed',
          latency_ms = 18000, finished_at = now()
        where id = ${`run_${key}`}`;
      await owner`update resolutions set citations = ${citations} where run_id = ${`run_${key}`}`;
      return (await get(`/cases/${seeded.caseId}`)).text();
    };
    const realDetail = await seen('mirror', false);
    const canaryDetail = await seen('mirrortwin', true);
    expect(canaryDetail).not.toMatch(/canary/i);
    expect(new Set(keyPathsOf(JSON.parse(canaryDetail)))).toEqual(
      new Set(keyPathsOf(JSON.parse(realDetail))),
    );
  });

  it('shows a re-run canary case queued again, its canary superseded, like any re-run', async () => {
    const { caseId, actionId } = await seedProposal(owner, 'twinrerun', {
      canary: true,
    });
    await owner`insert into canary_cases (case_id, defect) values (${caseId}, 'cold_tone')`;
    expect((await rerun(caseId)).status).toBe(HTTP.ok);
    const detail = await detailOf(caseId);
    expect(detail.case.status).toBe('queued');
    expect(detail.proposal).toMatchObject({
      action_id: actionId,
      status: 'superseded',
    });
    expect(detail.override_options).toBeNull();
  });
});
