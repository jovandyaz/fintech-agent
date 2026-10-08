import {
  MAX_ACTION_TRANSACTIONS,
  type CardTx,
  type SpeiTx,
  type Transaction,
} from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import {
  overrideOptionsOf,
  shapeViolation,
  stateViolation,
} from './allowed.js';

const spei = (id: string, over: Partial<SpeiTx> = {}): SpeiTx => ({
  id,
  customer_id: 'cus_01',
  amount: -500,
  created_at: '2026-10-01T10:00:00-06:00',
  status: 'settled',
  type: 'spei_out',
  counterparty_name: 'Ana',
  counterparty_clabe: '•••• 7891',
  tracking_key: '•••• 0001',
  numeric_reference: '1234567',
  settled_at: '2026-10-01T10:00:05-06:00',
  hold_reason: null,
  return_reason: null,
  returned_at: null,
  reversal_credit_id: null,
  reverses_tx_id: null,
  reject_reason: null,
  cep_available: true,
  ...over,
});

const card = (id: string, over: Partial<CardTx> = {}): CardTx => ({
  id,
  customer_id: 'cus_01',
  amount: -320,
  created_at: '2026-10-02T12:00:00-06:00',
  status: 'settled',
  type: 'card_purchase',
  merchant_descriptor: 'TIENDA',
  merchant_brand: 'Tienda',
  channel: 'card_not_present',
  auth_factors: 1,
  decline_reason: null,
  ...over,
});

const cards = (n: number): Transaction[] =>
  Array.from({ length: n }, (_, i) => card(`tx_c${i}`));

describe('shapeViolation (02 G2 table: count, uniqueness and state)', () => {
  it.each<
    [
      string,
      Parameters<typeof shapeViolation>,
      ReturnType<typeof shapeViolation>,
    ]
  >([
    ['none with no transactions', ['none', []], null],
    ['none with one', ['none', cards(1)], 'transaction_count'],
    ['open_dispute with none', ['open_dispute', []], 'transaction_count'],
    [
      'open_dispute on 1 settled card purchase',
      ['open_dispute', cards(1)],
      null,
    ],
    ['open_dispute on 3', ['open_dispute', cards(3)], null],
    ['open_dispute on 4', ['open_dispute', cards(4)], 'transaction_count'],
    [
      'open_dispute on a pending card purchase',
      ['open_dispute', [card('tx_p', { status: 'pending' })]],
      null,
    ],
    [
      'open_dispute on a declined card purchase',
      ['open_dispute', [card('tx_d', { status: 'rejected' })]],
      'transaction_state',
    ],
    [
      'open_dispute on a settled SPEI out',
      ['open_dispute', [spei('tx_s')]],
      null,
    ],
    [
      'open_dispute on a pending SPEI out',
      ['open_dispute', [spei('tx_s', { status: 'pending' })]],
      'transaction_state',
    ],
    [
      'open_dispute on a SPEI in',
      ['open_dispute', [spei('tx_i', { type: 'spei_in' })]],
      'transaction_state',
    ],
    [
      'open_dispute naming one transaction twice',
      ['open_dispute', [card('tx_a'), card('tx_a')]],
      'duplicate_transaction',
    ],
    [
      'resend_cep on one settled SPEI in',
      ['resend_cep', [spei('tx_i', { type: 'spei_in' })]],
      null,
    ],
    [
      'resend_cep on one settled SPEI out',
      ['resend_cep', [spei('tx_s')]],
      null,
    ],
    [
      'resend_cep on two',
      ['resend_cep', [spei('tx_a'), spei('tx_b')]],
      'transaction_count',
    ],
    [
      'resend_cep on a pending SPEI',
      ['resend_cep', [spei('tx_s', { status: 'pending' })]],
      'transaction_state',
    ],
    [
      'resend_cep on a card purchase',
      ['resend_cep', cards(1)],
      'transaction_state',
    ],
    ['escalate_fraud with none', ['escalate_fraud', []], null],
    [
      'escalate_fraud on 5 of any kind',
      ['escalate_fraud', [...cards(4), spei('tx_s', { status: 'rejected' })]],
      null,
    ],
    ['escalate_fraud on 6', ['escalate_fraud', cards(6)], 'transaction_count'],
  ])('%s', (_, args, expected) => {
    expect(shapeViolation(...args)).toBe(expected);
  });
});

describe('overrideOptionsOf', () => {
  it('offers each action with the transactions its G2 row allows, as decide checks them', () => {
    const transactions = [
      card('tx_card', { status: 'settled' }),
      card('tx_rejected', { status: 'rejected' }),
      spei('tx_spei'),
    ];
    expect(overrideOptionsOf(transactions)).toEqual([
      {
        type: 'open_dispute',
        min: 1,
        max: 3,
        transaction_ids: ['tx_card', 'tx_spei'],
      },
      { type: 'resend_cep', min: 1, max: 1, transaction_ids: ['tx_spei'] },
      {
        type: 'escalate_fraud',
        min: 0,
        max: MAX_ACTION_TRANSACTIONS,
        transaction_ids: ['tx_card', 'tx_rejected', 'tx_spei'],
      },
      { type: 'none', min: 0, max: 0, transaction_ids: [] },
    ]);
  });

  it('offers only transactions stateViolation accepts for that action alone', () => {
    const transactions = [card('tx_card'), spei('tx_spei')];
    for (const option of overrideOptionsOf(transactions)) {
      for (const id of option.transaction_ids) {
        const one = transactions.filter((tx) => tx.id === id);
        expect(
          stateViolation(option.type, one),
          `${option.type} ${id}`,
        ).toBeNull();
      }
    }
  });
});
