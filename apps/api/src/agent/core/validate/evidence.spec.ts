import { describe, expect, it } from 'vitest';

import {
  cardAuth,
  cardRow,
  customerSeen,
  listed,
  policyChunk,
  runOf,
  searched,
  speiRow,
  speiStatus,
} from '../../../../test/validator-fixtures.js';
import { buildEvidence } from './evidence.js';

describe('buildEvidence', () => {
  it('collects the transaction ids of every tool output the run received', () => {
    const evidence = buildEvidence(
      runOf([
        listed(cardRow(), speiRow()),
        { tool: 'get_spei_status', output: speiStatus({ id: 'tx_s002' }) },
        { tool: 'get_card_authorization', output: cardAuth({ id: 'tx_c002' }) },
      ]),
    );
    expect([...evidence.transactions.keys()].sort()).toEqual([
      'tx_c001',
      'tx_c002',
      'tx_s001',
      'tx_s002',
    ]);
  });

  it('collects the chunks search_policies returned and the customer view', () => {
    const evidence = buildEvidence(
      runOf([searched(policyChunk()), customerSeen]),
    );
    expect([...evidence.chunks.keys()]).toEqual(['chunk_p04s2']);
    expect(evidence.customer?.first_name).toBe('Ana');
  });

  it('keeps retrieved chunks out of the grounding outputs, cited or not', () => {
    const evidence = buildEvidence(
      runOf([searched(policyChunk()), customerSeen]),
    );
    expect(evidence.outputs).toEqual([customerSeen.output]);
  });

  it('keeps the last status output when a transaction is looked up twice', () => {
    const evidence = buildEvidence(
      runOf([
        { tool: 'get_spei_status', output: speiStatus({ status: 'pending' }) },
        { tool: 'get_spei_status', output: speiStatus({ status: 'settled' }) },
      ]),
    );
    expect(evidence.speiStatuses.get('tx_s001')?.status).toBe('settled');
  });

  it('ignores an output that does not parse against its tool schema', () => {
    const evidence = buildEvidence(
      runOf([
        { tool: 'get_spei_status', output: { error: 'NOT_FOUND' } },
        {
          tool: 'list_transactions',
          output: { items: [{ ...cardRow(), injected: true }], total: 1 },
        },
        { tool: 'get_card_authorization', output: speiStatus() },
      ]),
    );
    expect(evidence.transactions.size).toBe(0);
    expect(evidence.outputs).toEqual([]);
  });

  it('prefers the status output over the list row for the same transaction', () => {
    const evidence = buildEvidence(
      runOf([
        { tool: 'get_spei_status', output: speiStatus({ status: 'returned' }) },
        listed(speiRow({ status: 'settled' })),
      ]),
    );
    expect(evidence.transactions.get('tx_s001')?.status).toBe('returned');
  });

  it('reads a card authorization as a card purchase with its factors', () => {
    const evidence = buildEvidence(
      runOf([
        listed(cardRow({ auth_factors: 1 })),
        {
          tool: 'get_card_authorization',
          output: cardAuth({ auth_factors: 2 }),
        },
      ]),
    );
    expect(evidence.transactions.get('tx_c001')).toMatchObject({
      type: 'card_purchase',
      auth_factors: 2,
      merchant: 'AMZN MKTP MX',
      channel: 'card_not_present',
    });
  });
});
