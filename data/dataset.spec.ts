import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  isRegistryId,
  maskPii,
  TX_STATUSES,
  TX_TYPES,
  WebhookEventSchema,
  type CardTx,
  type Transaction,
} from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import { DATASET_SEED, generateDataset } from './generate.js';
import { SCENARIO_IDS, SCENARIOS } from './scenarios.js';

const DATA_DIR = import.meta.dirname;
const CUSTOMERS = 20;
const MIN_TRANSACTIONS = 190;
const MAX_TRANSACTIONS = 210;
const BURST_CHARGES = 3;
const BURST_WINDOW_MS = 24 * 60 * 60 * 1000;
const LAST_FOUR = 4;
const CONFLICT_TX = 'tx_cf01a';
const BURST_SCENARIO_TXS = new Set(['tx_cu02a', 'tx_cu02b', 'tx_cu02c']);

const dataset = generateDataset(DATASET_SEED);
const readJson = (file: string): unknown =>
  JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8'));

const isCard = (tx: Transaction): tx is CardTx => tx.type === 'card_purchase';

describe('generated dataset', () => {
  it('is what is committed, so the seed fully determines it', () => {
    expect(readJson('customers.json')).toEqual(dataset.customers);
    expect(readJson('transactions.json')).toEqual(dataset.transactions);
    const committed = readdirSync(join(DATA_DIR, 'webhook-fixtures')).sort();
    expect(committed).toEqual(
      [...SCENARIO_IDS].map((id) => `${id}.json`).sort(),
    );
    for (const fixture of dataset.fixtures) {
      expect(readJson(`webhook-fixtures/${fixture.scenario_id}.json`)).toEqual(
        fixture.event,
      );
    }
  });

  it('has 20 customers and about 200 transactions of every type and state', () => {
    expect(dataset.customers).toHaveLength(CUSTOMERS);
    expect(dataset.transactions.length).toBeGreaterThanOrEqual(
      MIN_TRANSACTIONS,
    );
    expect(dataset.transactions.length).toBeLessThanOrEqual(MAX_TRANSACTIONS);
    expect(new Set(dataset.transactions.map((t) => t.type))).toEqual(
      new Set(TX_TYPES),
    );
    expect(new Set(dataset.transactions.map((t) => t.status))).toEqual(
      new Set(TX_STATUSES),
    );
  });

  it('plants every scenario transaction with its state, owned by its customer', () => {
    const byId = new Map(dataset.transactions.map((t) => [t.id, t]));
    for (const scenario of SCENARIOS) {
      for (const planted of scenario.transactions) {
        const tx = byId.get(planted.id);
        expect(tx, planted.id).toEqual({
          ...planted,
          customer_id: scenario.customer_id,
        });
      }
    }
  });

  it('uses registry ids for every customer and transaction', () => {
    for (const { id } of [...dataset.customers, ...dataset.transactions]) {
      expect(isRegistryId(id), id).toBe(true);
    }
    const ids = dataset.transactions.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives customers a valid CLABE and a Luhn-valid card', () => {
    for (const customer of dataset.customers) {
      const clabeLast4 = customer.clabe.slice(-LAST_FOUR);
      const panLast4 = customer.card_pan.slice(-LAST_FOUR);
      expect(maskPii(customer.clabe)).toBe(`CLABE ••••${clabeLast4}`);
      expect(maskPii(customer.card_pan)).toBe(`tarjeta ••••${panLast4}`);
    }
  });

  it('gives every SPEI counterparty a valid CLABE', () => {
    for (const tx of dataset.transactions) {
      if (tx.type === 'card_purchase') continue;
      const last4 = tx.counterparty_clabe.slice(-LAST_FOUR);
      expect(maskPii(tx.counterparty_clabe), tx.id).toBe(`CLABE ••••${last4}`);
    }
  });

  it('credits back every returned SPEI out except CONFLICT-01', () => {
    const byId = new Map(dataset.transactions.map((t) => [t.id, t]));
    const returned = dataset.transactions.filter(
      (t) => t.type === 'spei_out' && t.status === 'returned',
    );
    expect(returned.length).toBeGreaterThan(1);
    for (const tx of returned) {
      if (tx.type === 'card_purchase') continue;
      if (tx.id === CONFLICT_TX) {
        expect(tx.reversal_credit_id).toBeNull();
        continue;
      }
      const credit = byId.get(tx.reversal_credit_id ?? '');
      expect(credit, tx.id).toMatchObject({
        type: 'spei_in',
        status: 'settled',
        amount: tx.amount,
        customer_id: tx.customer_id,
        reverses_tx_id: tx.id,
      });
    }
  });

  it('has no card-not-present burst except the one CARD-UNREC-02 plants', () => {
    const cnp = dataset.transactions
      .filter(isCard)
      .filter((t) => t.channel === 'card_not_present');
    for (const tx of cnp) {
      const start = Date.parse(tx.created_at);
      const burst = cnp.filter(
        (o) =>
          o.customer_id === tx.customer_id &&
          o.merchant_descriptor === tx.merchant_descriptor &&
          Date.parse(o.created_at) >= start &&
          Date.parse(o.created_at) - start <= BURST_WINDOW_MS,
      );
      if (burst.length >= BURST_CHARGES) {
        expect(burst.every((o) => BURST_SCENARIO_TXS.has(o.id))).toBe(true);
      }
    }
  });

  it('never plants a filler fraud signal: holds and fraud declines are scenario-only', () => {
    const planted = new Set(
      SCENARIOS.flatMap((s) => s.transactions.map((t) => t.id)),
    );
    for (const tx of dataset.transactions.filter((t) => !planted.has(t.id))) {
      if (isCard(tx)) {
        expect(tx.decline_reason).not.toBe('card_blocked_fraud');
      } else {
        expect(tx.hold_reason).toBeNull();
      }
    }
  });

  it("keeps ADV-08 grounded only on its own amount, not the customer's $5,000", () => {
    const adv08 = dataset.transactions.filter(
      (t) => t.customer_id === 'cus_20',
    );
    expect(adv08.some((t) => t.amount === 5000)).toBe(false);
  });

  it('writes one valid webhook fixture per scenario', () => {
    const customers = new Set(dataset.customers.map((c) => c.id));
    expect(dataset.fixtures.map((f) => f.scenario_id)).toEqual([
      ...SCENARIO_IDS,
    ]);
    for (const { event } of dataset.fixtures) {
      expect(WebhookEventSchema.safeParse(event).success).toBe(true);
      expect(customers.has(event.customer_id)).toBe(true);
    }
  });

  it('puts real personal data in the cases that test masking', () => {
    const text = (id: string): string =>
      dataset.fixtures.find((f) => f.scenario_id === id)?.event.text ?? '';
    const cus10 = dataset.customers.find((c) => c.id === 'cus_10');
    const cus19 = dataset.customers.find((c) => c.id === 'cus_19');
    expect(text('CARD-DECL-01')).toContain(cus10?.card_pan);
    expect(text('ADV-06')).toContain(cus19?.clabe);
    expect(maskPii(text('ADV-10'))).not.toMatch(/\d{8}/);
  });
});
