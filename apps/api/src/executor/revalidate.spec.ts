import {
  MS_PER_HOUR,
  SPEI_DISPUTE_AFTER_HOURS,
  type CardTx,
  type SpeiTx,
  type Transaction,
} from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import { revalidate } from './revalidate.js';

const NOW = new Date('2026-10-05T15:00:00-06:00');
const hoursAgo = (hours: number): string =>
  new Date(NOW.getTime() - hours * MS_PER_HOUR).toISOString();

const card = (over: Partial<CardTx> = {}): CardTx => ({
  id: 'tx_c1',
  customer_id: 'cus_07',
  amount: -899,
  created_at: hoursAgo(40),
  status: 'settled',
  type: 'card_purchase',
  merchant_descriptor: 'PAYPAL',
  merchant_brand: 'Paypal',
  channel: 'card_not_present',
  auth_factors: 1,
  decline_reason: null,
  ...over,
});

const speiOut = (
  settledHoursAgo: number,
  over: Partial<SpeiTx> = {},
): SpeiTx => ({
  id: 'tx_s1',
  customer_id: 'cus_07',
  amount: -12000,
  created_at: hoursAgo(settledHoursAgo),
  status: 'settled',
  type: 'spei_out',
  counterparty_name: 'Ana',
  counterparty_clabe: '•••• 7891',
  tracking_key: '•••• 0001',
  numeric_reference: '1234567',
  settled_at: hoursAgo(settledHoursAgo),
  hold_reason: null,
  return_reason: null,
  returned_at: null,
  reversal_credit_id: null,
  reverses_tx_id: null,
  reject_reason: null,
  cep_available: true,
  ...over,
});

const dispute = (ids: string[]) => ({
  type: 'open_dispute' as const,
  transaction_ids: ids,
});

describe('revalidate (02 G2, re-checked by the executor on fresh data)', () => {
  it.each<
    [
      string,
      Parameters<typeof revalidate>[0],
      (Transaction | null)[],
      ReturnType<typeof revalidate>,
    ]
  >([
    [
      'a dispute on the customer’s settled card purchase',
      dispute(['tx_c1']),
      [card()],
      null,
    ],
    ['a transaction core no longer has', dispute(['tx_c1']), [null], 'missing'],
    [
      'a transaction of another customer',
      dispute(['tx_c1']),
      [card({ customer_id: 'cus_02' })],
      'not_owned',
    ],
    [
      'a purchase that is now declined',
      dispute(['tx_c1']),
      [card({ status: 'rejected' })],
      'transaction_state',
    ],
    [
      'a SPEI dispute inside the policy window',
      dispute(['tx_s1']),
      [speiOut(SPEI_DISPUTE_AFTER_HOURS - 1)],
      'spei_window',
    ],
    [
      'a SPEI dispute past the policy window',
      dispute(['tx_s1']),
      [speiOut(SPEI_DISPUTE_AFTER_HOURS + 1)],
      null,
    ],
    [
      'a SPEI dispute whose settlement time cannot be read',
      dispute(['tx_s1']),
      [speiOut(SPEI_DISPUTE_AFTER_HOURS + 1, { settled_at: 'yesterday' })],
      'spei_window',
    ],
    [
      'a CEP resend right after settlement',
      { type: 'resend_cep', transaction_ids: ['tx_s1'] },
      [speiOut(1)],
      null,
    ],
    [
      'a fraud escalation with no transaction',
      { type: 'escalate_fraud', transaction_ids: [] },
      [],
      null,
    ],
  ])('%s', (_, action, transactions, expected) => {
    expect(revalidate(action, 'cus_07', transactions, NOW)).toBe(expected);
  });
});
