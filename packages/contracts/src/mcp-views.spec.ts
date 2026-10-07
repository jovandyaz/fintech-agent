import { describe, expect, it } from 'vitest';

import type { CardTx, SpeiTx } from './core.js';
import {
  cardAuthorizationOf,
  speiStatusOf,
  transactionRowOf,
} from './mcp-views.js';

const spei: SpeiTx = {
  id: 'tx_s001',
  customer_id: 'cus_01',
  type: 'spei_out',
  status: 'settled',
  amount: 2500,
  created_at: '2026-10-05T16:00:00Z',
  counterparty_name: 'Luis Pérez Gómez',
  counterparty_clabe: '002010077777777771',
  tracking_key: 'MBAN01002610050000427781',
  numeric_reference: '1234567',
  settled_at: '2026-10-05T16:00:05Z',
  hold_reason: null,
  return_reason: null,
  returned_at: null,
  reversal_credit_id: null,
  reverses_tx_id: null,
  reject_reason: null,
  cep_available: true,
};

const card: CardTx = {
  id: 'tx_c001',
  customer_id: 'cus_01',
  type: 'card_purchase',
  status: 'rejected',
  amount: 899,
  created_at: '2026-10-05T18:00:00Z',
  merchant_descriptor: 'PAYPAL *SHOP',
  merchant_brand: 'PayPal',
  channel: 'card_not_present',
  auth_factors: 1,
  decline_reason: 'card_blocked_fraud',
};

describe('MCP views', () => {
  it('lists a SPEI with the counterparty first name and a masked CLABE', () => {
    expect(transactionRowOf(spei)).toEqual({
      id: 'tx_s001',
      type: 'spei_out',
      status: 'settled',
      amount: 2500,
      created_at: '2026-10-05T16:00:00Z',
      counterparty_first_name: 'Luis',
      counterparty_clabe: 'CLABE ••••7771',
    });
  });

  it('gives a SPEI status the last four of the tracking key only', () => {
    expect(speiStatusOf(spei).tracking_key_last4).toBe('7781');
    expect(JSON.stringify(speiStatusOf(spei))).not.toContain(spei.tracking_key);
  });

  it('reads a rejected card purchase as a declined authorization', () => {
    expect(cardAuthorizationOf(card)).toMatchObject({
      decision: 'declined',
      decline_reason: 'card_blocked_fraud',
      auth_factors: 1,
    });
  });
});
