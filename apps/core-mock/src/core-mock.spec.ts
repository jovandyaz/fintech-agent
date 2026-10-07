import type { AddressInfo } from 'node:net';

import type { CardTx, Customer, SpeiTx } from '@fintech-agent/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCoreMock, type CoreMock } from './server.js';

const READ_KEY = 'test-read-key';
const EXECUTOR_KEY = 'test-executor-key';
const OWNER = 'cus_01';
const OTHER = 'cus_02';

const customer = (id: string): Customer => ({
  id,
  first_name: 'Ana',
  last_names: 'Gómez Pérez',
  rfc: 'GOPA741222HKG',
  curp: 'GOPA741222MDFGHJP1',
  email: 'ana.gomez@example.com',
  phone: '5532732905',
  clabe: '646180590988801788',
  card_pan: '4761343220832617',
  card_status: 'active',
  kyc_level: 'N3',
  account_status: 'active',
});

const speiOut: SpeiTx = {
  id: 'tx_so02a',
  customer_id: OWNER,
  type: 'spei_out',
  status: 'settled',
  amount: 12000,
  created_at: '2026-10-02T11:20:00-06:00',
  counterparty_name: 'María Fernanda López Ruiz',
  counterparty_clabe: '072180009876543213',
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

const cardCharge: CardTx = {
  id: 'tx_cu01a',
  customer_id: OWNER,
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

const foreignCharge: CardTx = {
  ...cardCharge,
  id: 'tx_f001',
  customer_id: OTHER,
};

let core: CoreMock;
let base: string;

const read = (path: string, key = READ_KEY): Promise<Response> =>
  fetch(`${base}${path}`, { headers: { 'x-core-key': key } });

const write = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-executor-key': EXECUTOR_KEY,
      'idempotency-key': 'act_ab12',
      ...headers,
    },
    body: JSON.stringify(body),
  });

const dispute = {
  action_id: 'act_ab12',
  customer_id: OWNER,
  transaction_ids: [cardCharge.id],
  reason_code: 'unrecognized_charge',
};

beforeEach(async () => {
  core = createCoreMock({
    customers: [customer(OWNER), customer(OTHER)],
    transactions: [speiOut, cardCharge, foreignCharge],
    readKey: READ_KEY,
    executorKey: EXECUTOR_KEY,
    databasePath: ':memory:',
  });
  await new Promise<void>((resolve) => core.server.listen(0, resolve));
  const { port } = core.server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => core.server.close(() => resolve()));
  core.close();
});

describe('core-mock reads', () => {
  it('answers health without a key', async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
  });

  it('refuses reads without a known key', async () => {
    expect((await read(`/customers/${OWNER}`, 'nope')).status).toBe(401);
    expect((await fetch(`${base}/customers/${OWNER}`)).status).toBe(401);
  });

  it('serves a customer and a transaction with full values', async () => {
    const response = await read(`/customers/${OWNER}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      clabe: '646180590988801788',
    });
    const tx = await read(`/transactions/${speiOut.id}`);
    expect(await tx.json()).toEqual(speiOut);
  });

  it('returns 404 for an unknown customer or transaction', async () => {
    expect((await read('/customers/cus_99')).status).toBe(404);
    expect((await read('/transactions/tx_nope')).status).toBe(404);
  });

  it('lists only the customer’s transactions, newest first, filtered and paginated', async () => {
    const all = await (await read(`/customers/${OWNER}/transactions`)).json();
    expect(all).toEqual({
      items: [cardCharge, speiOut],
      total: 2,
      next_cursor: null,
    });
    const filtered = await (
      await read(
        `/customers/${OWNER}/transactions?type=card_purchase&min_amount=500&query=paypal`,
      )
    ).json();
    expect(filtered).toEqual({
      items: [cardCharge],
      total: 1,
      next_cursor: null,
    });
    const firstPage = await (
      await read(`/customers/${OWNER}/transactions?limit=1`)
    ).json();
    expect(firstPage).toEqual({
      items: [cardCharge],
      total: 2,
      next_cursor: '1',
    });
    const secondPage = await (
      await read(`/customers/${OWNER}/transactions?limit=1&cursor=1`)
    ).json();
    expect(secondPage).toEqual({
      items: [speiOut],
      total: 2,
      next_cursor: null,
    });
  });

  it('caps the page size at 25', async () => {
    const response = await read(`/customers/${OWNER}/transactions?limit=500`);
    expect(response.status).toBe(400);
  });
});

describe('core-mock writes (02 G1, G3)', () => {
  it('refuses a write with the read key or no key', async () => {
    expect(
      (await write('/disputes', dispute, { 'x-executor-key': READ_KEY }))
        .status,
    ).toBe(401);
  });

  it('requires an idempotency key', async () => {
    expect(
      (await write('/disputes', dispute, { 'idempotency-key': '' })).status,
    ).toBe(400);
  });

  it('opens a dispute once and returns the first result on a repeat', async () => {
    const first = await write('/disputes', dispute);
    expect(first.status).toBe(201);
    const created = await first.json();
    const again = await write('/disputes', dispute);
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(created);
    expect(core.effects()).toHaveLength(1);
  });

  it('rejects a reused key with a different body', async () => {
    await write('/disputes', dispute);
    const reused = await write('/disputes', {
      ...dispute,
      reason_code: 'suspected_card_fraud',
    });
    expect(reused.status).toBe(422);
    expect(core.effects()).toHaveLength(1);
  });

  it('refuses transactions the customer does not own', async () => {
    const response = await write('/disputes', {
      ...dispute,
      transaction_ids: [foreignCharge.id],
    });
    expect(response.status).toBe(422);
    expect(core.effects()).toHaveLength(0);
  });

  it('serves all three write endpoints', async () => {
    const cep = await write(
      '/cep/resend',
      { ...dispute, transaction_ids: [speiOut.id] },
      { 'idempotency-key': 'act_cd34' },
    );
    const fraud = await write(
      '/fraud/escalations',
      { ...dispute, transaction_ids: [] },
      { 'idempotency-key': 'act_ef56' },
    );
    expect([cep.status, fraud.status]).toEqual([201, 201]);
    expect(core.effects().map((e) => e.endpoint)).toEqual([
      '/cep/resend',
      '/fraud/escalations',
    ]);
  });

  it('rejects a malformed body', async () => {
    const response = await write('/disputes', { action_id: 'act_ab12' });
    expect(response.status).toBe(400);
  });
});
