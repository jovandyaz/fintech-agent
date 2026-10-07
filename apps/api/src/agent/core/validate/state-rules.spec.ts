import type { StateRule } from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import {
  SPEI_TX,
  cardAuth,
  listed,
  runOf,
  speiRow,
  speiStatus,
} from '../../../../test/validator-fixtures.js';
import { buildEvidence, type ToolResult } from './evidence.js';
import { policyConflicts, type ChunkStateRules } from './state-rules.js';

const RETURN_CREDIT: StateRule = {
  id: 'return_credit_same_day',
  applies_to: {
    type: 'spei_out',
    status: 'returned',
    returned_business_days_ago: '>=1',
  },
  requires: { field: 'reversal_credit_id', not_null: true },
};

const corpus = (
  rules: readonly StateRule[] = [RETURN_CREDIT],
  quarantined = false,
): ChunkStateRules[] => [{ chunk_id: 'chunk_p02s3', quarantined, rules }];

const returned = (overrides: Parameters<typeof speiStatus>[0] = {}) =>
  speiStatus({
    status: 'returned',
    returned_at: '2026-10-02T17:00:00Z',
    return_reason: 'cuenta_inexistente',
    ...overrides,
  });

const conflictsOf = (
  toolResults: ToolResult[],
  chunks: ChunkStateRules[] = corpus(),
) => policyConflicts(buildEvidence(runOf(toolResults)), chunks);

describe('policyConflicts', () => {
  it('finds a returned SPEI with no reversal credit three business days on', () => {
    expect(
      conflictsOf([{ tool: 'get_spei_status', output: returned() }]),
    ).toEqual([
      {
        rule_id: 'return_credit_same_day',
        chunk_id: 'chunk_p02s3',
        transaction_id: SPEI_TX,
        field: 'reversal_credit_id',
      },
    ]);
  });

  it('holds when the reversal credit is there or no business day has passed', () => {
    expect(
      conflictsOf([
        {
          tool: 'get_spei_status',
          output: returned({ reversal_credit_id: 'tx_r001' }),
        },
      ]),
    ).toEqual([]);
    expect(
      conflictsOf([
        {
          tool: 'get_spei_status',
          output: returned({ returned_at: '2026-10-07T14:00:00Z' }),
        },
      ]),
    ).toEqual([]);
  });

  it('compares the business days with every operator the schema allows', () => {
    const withDays = (comparison: string): ChunkStateRules[] =>
      corpus([
        {
          ...RETURN_CREDIT,
          applies_to: {
            ...RETURN_CREDIT.applies_to,
            returned_business_days_ago: comparison,
          },
        },
      ]);
    const threeDaysOn = [
      { tool: 'get_spei_status' as const, output: returned() },
    ];
    const fires = (comparison: string) =>
      conflictsOf(threeDaysOn, withDays(comparison)).length === 1;
    expect(['>=3', '<=3', '>2', '<4', '=3'].map(fires)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(['>=4', '<=2', '>3', '<3', '=2'].map(fires)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('applies a rule only to the type and status it names', () => {
    expect(
      conflictsOf([
        { tool: 'get_spei_status', output: returned({ type: 'spei_in' }) },
      ]),
    ).toEqual([]);
    const anyReturn: StateRule = {
      id: 'returned_has_credit',
      applies_to: { type: 'spei_out', status: 'returned' },
      requires: { field: 'reversal_credit_id', not_null: true },
    };
    expect(
      conflictsOf(
        [{ tool: 'get_spei_status', output: speiStatus() }],
        corpus([anyReturn]),
      ),
    ).toEqual([]);
    expect(
      conflictsOf(
        [{ tool: 'get_spei_status', output: returned() }],
        corpus([anyReturn]),
      ),
    ).toHaveLength(1);
  });

  it('counts business days up to the case reception, not to the clock', () => {
    expect(
      policyConflicts(
        buildEvidence(
          runOf([{ tool: 'get_spei_status', output: returned() }], {
            receivedAt: new Date('2026-10-02T20:00:00Z'),
          }),
        ),
        corpus(),
      ),
    ).toEqual([]);
  });

  it('never matches a day comparison when the return time is missing', () => {
    const recentReturn: StateRule = {
      ...RETURN_CREDIT,
      applies_to: {
        ...RETURN_CREDIT.applies_to,
        returned_business_days_ago: '<=3',
      },
    };
    expect(
      conflictsOf(
        [{ tool: 'get_spei_status', output: returned({ returned_at: null }) }],
        corpus([recentReturn]),
      ),
    ).toEqual([]);
  });

  it('never runs a quarantined chunk’s rules', () => {
    expect(
      conflictsOf(
        [{ tool: 'get_spei_status', output: returned() }],
        corpus([RETURN_CREDIT], true),
      ),
    ).toEqual([]);
  });

  it('never fires on a transaction without a status output', () => {
    expect(conflictsOf([listed(speiRow({ status: 'returned' }))])).toEqual([]);
  });

  it('reads only fields the output contains', () => {
    const cardRule: StateRule = {
      id: 'card_credit',
      applies_to: { type: 'card_purchase' },
      requires: { field: 'reversal_credit_id', not_null: true },
    };
    expect(
      conflictsOf(
        [{ tool: 'get_card_authorization', output: cardAuth() }],
        corpus([cardRule]),
      ),
    ).toEqual([]);
  });

  it('does not match a derived field the output cannot give', () => {
    expect(
      conflictsOf([
        { tool: 'get_spei_status', output: returned({ returned_at: null }) },
      ]),
    ).toEqual([]);
  });

  it('matches a card authorization as a card purchase', () => {
    const declinedNeedsReason: StateRule = {
      id: 'decline_has_reason',
      applies_to: { type: 'card_purchase', status: 'rejected' },
      requires: { field: 'decline_reason', not_null: true },
    };
    expect(
      conflictsOf(
        [
          {
            tool: 'get_card_authorization',
            output: cardAuth({ status: 'rejected', decision: 'declined' }),
          },
        ],
        corpus([declinedNeedsReason]),
      ),
    ).toHaveLength(1);
  });
});
