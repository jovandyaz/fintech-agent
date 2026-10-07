import { CASE_FLAGS, type StateRule } from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import {
  POLICY_CHUNK_ID,
  RECEIVED_AT,
  SPEI_TX,
  cardAuth,
  cardRow,
  customerSeen,
  listed,
  resolutionOf,
  runOf,
  searched,
  policyChunk,
  speiRow,
  speiStatus,
} from '../../../test/validator-fixtures.js';
import { agentDisabled, settle, type SettleContext } from './persist.js';
import {
  buildEvidence,
  type RunEvidence,
  type ToolResult,
} from './validate/evidence.js';
import type { ValidationRun } from './validate/repair.js';
import type {
  ChunkStateRules,
  PolicyConflict,
} from './validate/state-rules.js';

const FOLIO = 'AC-7K2M-Q9XD';
const logs: Record<string, unknown>[] = [];
const context = (overrides: Partial<SettleContext> = {}): SettleContext => ({
  folio: FOLIO,
  receivedAt: RECEIVED_AT,
  priorOpenDisputes: 0,
  stateRules: [],
  log: (event) => logs.push(event),
  ...overrides,
});

const cardAuthSeen: ToolResult = {
  tool: 'get_card_authorization',
  output: cardAuth({ auth_factors: 1 }),
};
const evidenceOf = (
  extra: ToolResult[] = [],
  overrides: Parameters<typeof runOf>[1] = {},
): RunEvidence =>
  buildEvidence(
    runOf(
      [
        customerSeen,
        listed(cardRow({ auth_factors: 1 })),
        cardAuthSeen,
        searched(policyChunk()),
        ...extra,
      ],
      overrides,
    ),
  );

const valid = (
  overrides: Partial<Extract<ValidationRun, { kind: 'valid' }>> = {},
): { kind: 'validated'; validation: ValidationRun } => ({
  kind: 'validated',
  validation: {
    kind: 'valid',
    resolution: resolutionOf(),
    conflicts: [],
    evidence: evidenceOf(),
    repaired: false,
    ...overrides,
  },
});

const failedValidation = (
  evidence: RunEvidence = evidenceOf(),
  conflicts: PolicyConflict[] = [],
): { kind: 'validated'; validation: ValidationRun } => ({
  kind: 'validated',
  validation: {
    kind: 'fallback',
    codes: ['CITATION_QUOTE_MISMATCH'],
    action: {
      type: 'none',
      transaction_ids: [],
      reason_code: 'insufficient_information',
      justification:
        'Validation failed after one repair: CITATION_QUOTE_MISMATCH',
    },
    conflicts,
    evidence,
  },
});

const RETURN_RULE: StateRule = {
  id: 'return_credit_same_day',
  applies_to: { type: 'spei_out', status: 'returned' },
  requires: { field: 'reversal_credit_id', not_null: true },
};
const RULES: ChunkStateRules[] = [
  { chunk_id: POLICY_CHUNK_ID, quarantined: false, rules: [RETURN_RULE] },
];
const CONFLICT: PolicyConflict = {
  rule_id: RETURN_RULE.id,
  chunk_id: POLICY_CHUNK_ID,
  transaction_id: SPEI_TX,
  field: 'reversal_credit_id',
};
const EIGHT_DIGITS = /\d{8,}/;
const returnedWithoutCredit: ToolResult[] = [
  listed(speiRow({ status: 'returned' })),
  {
    tool: 'get_spei_status',
    output: speiStatus({ id: SPEI_TX, status: 'returned' }),
  },
];

describe('settle: an accepted resolution (01 §Persist)', () => {
  it('fills every placeholder from the case and the customer the run saw', () => {
    const settled = settle(valid(), context());
    expect(settled.runStatus).toBe('succeeded');
    expect(settled.stopReason).toBe('completed');
    expect(settled.resolution?.draft_reply).not.toMatch(/\{\{/);
    expect(settled.resolution?.draft_reply).toContain('Hola Ana');
    expect(settled.resolution?.draft_reply).toContain(FOLIO);
    expect(settled.action).toEqual(resolutionOf().proposed_action);
    expect(settled.category).toBe('unrecognized_card_charge');
  });

  it('sets the tier by code: high for a dispute, standard for a clean none', () => {
    expect(settle(valid(), context()).reviewTier).toBe('high');
    const none = resolutionOf({
      category: 'general_inquiry',
      evidence: [],
      proposed_action: {
        type: 'none',
        transaction_ids: [],
        reason_code: 'insufficient_information',
        justification: 'Sin información suficiente.',
      },
    });
    const settled = settle(
      valid({
        resolution: none,
        evidence: buildEvidence(runOf([customerSeen])),
      }),
      context(),
    );
    expect(settled.flags).toEqual([]);
    expect(settled.reviewTier).toBe('standard');
  });

  it('flags an abstained resolution', () => {
    const abstained = resolutionOf({ abstained: true, citations: [] });
    expect(settle(valid({ resolution: abstained }), context()).flags).toEqual([
      'abstained',
    ]);
  });

  it('flags a policy data conflict the validator found', () => {
    expect(settle(valid({ conflicts: [CONFLICT] }), context()).flags).toContain(
      'policy_data_conflict',
    );
  });

  it('flags the injection signal the intake scan raised', () => {
    const evidence = evidenceOf([], { injectionSignal: true });
    expect(settle(valid({ evidence }), context()).flags).toContain(
      'injection_signal',
    );
  });

  it('raises first_party_signal from the database count of prior disputes', () => {
    expect(settle(valid(), context()).flags).not.toContain(
      'first_party_signal',
    );
    expect(settle(valid(), context({ priorOpenDisputes: 3 })).flags).toContain(
      'first_party_signal',
    );
  });

  it('falls back when the filled reply fails the reply checks', () => {
    const linkName: ToolResult = {
      tool: 'get_customer',
      output: { ...customerSeen.output!, first_name: 'evil.example.com' },
    };
    const evidence = buildEvidence(
      runOf([linkName, listed(cardRow({ auth_factors: 1 })), cardAuthSeen]),
    );
    const settled = settle(valid({ evidence }), context());
    expect(settled.runStatus).toBe('fallback');
    expect(settled.stopReason).toBe('validation');
    expect(settled.resolution).toBeNull();
    expect(settled.category).toBeNull();
    expect(settled.action.type).toBe('none');
    expect(settled.action.justification).toContain('LINK_IN_REPLY');
    expect(settled.flags).toContain('fallback');
  });

  it('falls back and logs when a placeholder cannot be filled', () => {
    logs.length = 0;
    const abono = resolutionOf({
      draft_reply: 'Hola {{nombre}}, el abono llega el {{fecha_limite_abono}}.',
    });
    const settled = settle(
      valid({ resolution: abono }),
      context({ receivedAt: new Date('2031-01-05T15:00:00Z') }),
    );
    expect(settled.runStatus).toBe('fallback');
    expect(settled.stopReason).toBe('error');
    expect(settled.resolution).toBeNull();
    expect(settled.action.type).toBe('none');
    expect(settled.action.justification).toBe('Placeholder fill failed');
    expect(logs).toEqual([
      expect.objectContaining({ event: 'placeholder_fill_failed' }),
    ]);
  });

  it('falls back when the draft names a customer the run never saw', () => {
    const evidence = buildEvidence(
      runOf([listed(cardRow({ auth_factors: 1 })), cardAuthSeen]),
    );
    const settled = settle(valid({ evidence }), context());
    expect(settled.stopReason).toBe('error');
    expect(settled.resolution).toBeNull();
  });

  it('falls back when the customer name is not a name', () => {
    const digits: ToolResult = {
      tool: 'get_customer',
      output: { ...customerSeen.output!, first_name: 'Ana 500' },
    };
    const evidence = buildEvidence(
      runOf([digits, listed(cardRow({ auth_factors: 1 })), cardAuthSeen]),
    );
    const settled = settle(valid({ evidence }), context());
    expect(settled.runStatus).toBe('fallback');
    expect(settled.resolution).toBeNull();
  });

  it('logs a fill failure masked', () => {
    logs.length = 0;
    const odd = resolutionOf({
      draft_reply: 'Hola, tu número {{55123456789}}.',
    });
    settle(valid({ resolution: odd }), context());
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toMatch(EIGHT_DIGITS);
  });
});

describe('settle: the fallback (01 §Agent pipeline)', () => {
  it('proposes the validator fallback none with its visible reason', () => {
    const settled = settle(failedValidation(), context());
    expect(settled.runStatus).toBe('fallback');
    expect(settled.stopReason).toBe('validation');
    expect(settled.resolution).toBeNull();
    expect(settled.action.justification).toContain('CITATION_QUOTE_MISMATCH');
    expect(settled.flags).toContain('fallback');
    expect(settled.reviewTier).toBe('high');
  });

  it('keeps a suppressed dispute visible: a fallback has no category', () => {
    expect(settle(failedValidation(), context()).flags).toContain(
      'action_fact_mismatch',
    );
  });

  it('ends a budget stop as a fallback with its reason', () => {
    const settled = settle(
      {
        kind: 'stopped',
        stopReason: 'budget',
        reason: 'budget',
        evidence: evidenceOf(),
      },
      context(),
    );
    expect(settled).toMatchObject({
      runStatus: 'fallback',
      stopReason: 'budget',
      resolution: null,
      category: null,
    });
    expect(settled.action.type).toBe('none');
    expect(settled.action.justification).toContain('budget');
    expect(settled.flags).toContain('fallback');
  });

  it('ends an error stop as a fallback naming the failed tool', () => {
    const settled = settle(
      {
        kind: 'stopped',
        stopReason: 'error',
        reason: 'tool_failed:get_spei_status',
        evidence: evidenceOf(),
      },
      context(),
    );
    expect(settled.stopReason).toBe('error');
    expect(settled.action.justification).toContain(
      'tool_failed:get_spei_status',
    );
  });

  it('flags a policy conflict the validator fallback carries', () => {
    expect(
      settle(failedValidation(evidenceOf(), [CONFLICT]), context()).flags,
    ).toContain('policy_data_conflict');
  });

  it('flags a policy conflict in what a stopped run saw', () => {
    const outcome = {
      kind: 'stopped',
      stopReason: 'budget',
      reason: 'budget',
      evidence: evidenceOf(returnedWithoutCredit),
    } as const;
    expect(settle(outcome, context()).flags).not.toContain(
      'policy_data_conflict',
    );
    expect(settle(outcome, context({ stateRules: RULES })).flags).toContain(
      'policy_data_conflict',
    );
  });

  it('ends a run with the agent off as agent_disabled, flagged fallback', () => {
    const settled = settle(agentDisabled(false), context());
    expect(settled).toMatchObject({
      runStatus: 'fallback',
      stopReason: 'agent_disabled',
      resolution: null,
      category: null,
      flags: ['fallback'],
      reviewTier: 'high',
    });
    expect(settled.action.type).toBe('none');
  });

  it('keeps the intake injection flag and the dispute history with the agent off', () => {
    expect(
      settle(agentDisabled(true), context({ priorOpenDisputes: 3 })).flags,
    ).toEqual(['injection_signal', 'first_party_signal', 'fallback']);
  });
});

describe('settle: flags in CASE_FLAGS order', () => {
  const injected = evidenceOf([], { injectionSignal: true });

  it("orders a fallback's flags", () => {
    const flags = settle(
      failedValidation(injected, [CONFLICT]),
      context({ priorOpenDisputes: 3 }),
    ).flags;
    expect(flags).toEqual([
      'injection_signal',
      'policy_data_conflict',
      'action_fact_mismatch',
      'first_party_signal',
      'fallback',
    ]);
    expect(flags).toEqual(CASE_FLAGS.filter((flag) => flags.includes(flag)));
  });

  it("orders an accepted resolution's flags", () => {
    const abstained = resolutionOf({ abstained: true, citations: [] });
    expect(
      settle(
        valid({
          resolution: abstained,
          conflicts: [CONFLICT],
          evidence: injected,
        }),
        context({ priorOpenDisputes: 3 }),
      ).flags,
    ).toEqual([
      'injection_signal',
      'policy_data_conflict',
      'first_party_signal',
      'abstained',
    ]);
  });
});
