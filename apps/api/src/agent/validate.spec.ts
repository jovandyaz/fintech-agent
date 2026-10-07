import {
  MS_PER_HOUR,
  SPEI_DISPUTE_AFTER_HOURS,
  type Resolution,
} from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import {
  NOW,
  CARD_TX,
  POLICY_CHUNK_ID,
  SPEI_TX,
  cardAuth,
  cardRow,
  customerSeen,
  listed,
  policyChunk,
  resolutionOf,
  runOf,
  searched,
  speiRow,
  speiStatus,
} from '../../test/validator-fixtures.js';
import {
  buildEvidence,
  type RunFacts,
  type ToolResult,
} from './core/validate/evidence.js';
import { factFlags } from './core/validate/flags.js';
import { validate } from './core/validate/index.js';

const CARD_DISPUTE_RUN: ToolResult[] = [
  customerSeen,
  listed(cardRow(), speiRow()),
  { tool: 'get_card_authorization', output: cardAuth() },
  searched(policyChunk()),
];

const codesOf = (
  raw: unknown,
  toolResults: ToolResult[] = CARD_DISPUTE_RUN,
): readonly string[] => {
  const outcome = validate(raw, {
    evidence: buildEvidence(runOf(toolResults)),
  });
  return outcome.ok ? [] : outcome.codes;
};

const withAction = (
  action: Partial<Resolution['proposed_action']>,
): Resolution => {
  const resolution = resolutionOf();
  return {
    ...resolution,
    proposed_action: { ...resolution.proposed_action, ...action },
  };
};

describe('validate', () => {
  it('accepts a resolution every check holds for', () => {
    const resolution = resolutionOf();
    expect(
      validate(resolution, {
        evidence: buildEvidence(runOf(CARD_DISPUTE_RUN)),
      }),
    ).toEqual({ ok: true, resolution, conflicts: [] });
  });

  describe('SCHEMA', () => {
    it('fails an output outside ResolutionSchema and checks nothing else', () => {
      expect(codesOf({ ...resolutionOf(), amount: 500 })).toEqual(['SCHEMA']);
      expect(codesOf('{"category":')).toEqual(['SCHEMA']);
    });
  });

  describe('CITATION_UNSEEN', () => {
    it('fails a citation of a chunk the run never retrieved', () => {
      const [citation] = resolutionOf().citations;
      expect(
        codesOf(
          resolutionOf({
            citations: [{ ...citation!, chunk_id: 'chunk_p09s1' }],
          }),
        ),
      ).toEqual(['CITATION_UNSEEN']);
    });

    it('fails a seen chunk cited under another document or section', () => {
      const [citation] = resolutionOf().citations;
      expect(
        codesOf(
          resolutionOf({ citations: [{ ...citation!, doc_id: 'pol-03' }] }),
        ),
      ).toEqual(['CITATION_UNSEEN']);
      expect(
        codesOf(
          resolutionOf({ citations: [{ ...citation!, section: 'Otra' }] }),
        ),
      ).toEqual(['CITATION_UNSEEN']);
    });
  });

  describe('CITATION_QUOTE_MISMATCH', () => {
    const quoting = (quote: string): Resolution => {
      const [citation] = resolutionOf().citations;
      return resolutionOf({ citations: [{ ...citation!, quote }] });
    };

    it('fails a quote that is not in the cited chunk', () => {
      expect(codesOf(quoting('se abona el mismo día sin aclaración'))).toEqual([
        'CITATION_QUOTE_MISMATCH',
      ]);
    });

    it('matches after NFKC and whitespace collapsing', () => {
      expect(codesOf(quoting('a  más\ntardar el ｓｅｇｕｎｄｏ día'))).toEqual(
        [],
      );
    });

    it('fails a quote that normalizes to nothing', () => {
      expect(codesOf(quoting(' \n\t '))).toEqual(['CITATION_QUOTE_MISMATCH']);
    });
  });

  describe('EVIDENCE_UNSEEN', () => {
    it('fails evidence the run never saw', () => {
      expect(
        codesOf(
          resolutionOf({
            evidence: [
              { kind: 'card_auth', id: CARD_TX },
              { kind: 'transaction', id: 'tx_z999' },
            ],
          }),
        ),
      ).toEqual(['EVIDENCE_UNSEEN']);
    });

    it('fails an action on a transaction the run never saw', () => {
      expect(
        codesOf(withAction({ transaction_ids: [CARD_TX, 'tx_z999'] })),
      ).toContain('EVIDENCE_UNSEEN');
    });
  });

  describe('NO_SUPPORT', () => {
    it('fails a resolution with no citation that does not abstain', () => {
      expect(codesOf(resolutionOf({ citations: [] }))).toEqual(['NO_SUPPORT']);
    });

    it('accepts an abstention without citations', () => {
      expect(
        codesOf(
          resolutionOf({
            citations: [],
            abstained: true,
            draft_reply: 'Hola {{nombre}}, revisaremos tu caso.',
            proposed_action: {
              type: 'none',
              transaction_ids: [],
              reason_code: 'insufficient_information',
              justification: 'Sin política aplicable.',
            },
          }),
        ),
      ).toEqual([]);
    });
  });

  describe('ACTION_NOT_ALLOWED', () => {
    it('fails a combination outside the G2 table', () => {
      expect(
        codesOf(withAction({ type: 'resend_cep', transaction_ids: [CARD_TX] })),
      ).toContain('ACTION_NOT_ALLOWED');
      expect(
        codesOf(withAction({ type: 'none', transaction_ids: [CARD_TX] })),
      ).toContain('ACTION_NOT_ALLOWED');
      expect(
        codesOf(withAction({ transaction_ids: [CARD_TX, CARD_TX] })),
      ).toContain('ACTION_NOT_ALLOWED');
    });

    it('fails open_dispute on an incoming SPEI the run saw', () => {
      expect(
        codesOf(withAction({ transaction_ids: [SPEI_TX] }), [
          ...CARD_DISPUTE_RUN,
          {
            tool: 'get_spei_status',
            output: speiStatus({ type: 'spei_in' }),
          },
        ]),
      ).toContain('ACTION_NOT_ALLOWED');
    });

    it('checks the count even when a transaction was not seen', () => {
      expect(
        codesOf(
          withAction({
            transaction_ids: [CARD_TX, 'tx_z991', 'tx_z992', 'tx_z993'],
          }),
        ),
      ).toEqual(['EVIDENCE_UNSEEN', 'ACTION_NOT_ALLOWED']);
    });

    it('checks the state of the seen transactions next to an unseen one', () => {
      expect(
        codesOf(withAction({ transaction_ids: [SPEI_TX, 'tx_z999'] }), [
          ...CARD_DISPUTE_RUN,
          {
            tool: 'get_spei_status',
            output: speiStatus({ type: 'spei_in' }),
          },
        ]),
      ).toEqual(['EVIDENCE_UNSEEN', 'ACTION_NOT_ALLOWED']);
    });
  });

  it('checks a quote against the chunk it names, not any chunk seen', () => {
    const other = policyChunk({
      chunk_id: 'chunk_p02s1',
      doc_id: 'pol-02',
      section: 'Devoluciones',
      content: 'Un SPEI devuelto se abona el mismo día.',
    });
    const [citation] = resolutionOf().citations;
    expect(
      codesOf(
        resolutionOf({
          citations: [
            { ...citation!, chunk_id: POLICY_CHUNK_ID, quote: 'el mismo día' },
          ],
        }),
        [...CARD_DISPUTE_RUN, searched(other)],
      ),
    ).toEqual(['CITATION_QUOTE_MISMATCH']);
  });
});

const NEUTRAL_REPLY = 'Hola {{nombre}}, revisamos tu caso con folio {{folio}}.';
const hoursBefore = (hours: number): string =>
  new Date(NOW.getTime() - hours * MS_PER_HOUR).toISOString();

const proposing = (
  action: Partial<Resolution['proposed_action']>,
): Resolution => ({
  ...withAction(action),
  draft_reply: NEUTRAL_REPLY,
});

const codesIn = (raw: unknown, run: RunFacts): readonly string[] => {
  const outcome = validate(raw, { evidence: buildEvidence(run) });
  return outcome.ok ? [] : outcome.codes;
};

const speiDisputeRun = (settledAt: string): ToolResult[] => [
  ...CARD_DISPUTE_RUN,
  {
    tool: 'get_spei_status',
    output: speiStatus({ settled_at: settledAt }),
  },
];

const ESCALATE: Partial<Resolution['proposed_action']> = {
  type: 'escalate_fraud',
  transaction_ids: [],
  reason_code: 'suspected_card_fraud',
};

const cnpRows = (createdAt: readonly string[], merchant = 'AMZN MKTP MX') =>
  createdAt.map((created_at, index) =>
    cardRow({
      id: `tx_b00${index}`,
      created_at,
      merchant_descriptor: merchant,
    }),
  );

describe('ACTION_UNSUPPORTED', () => {
  describe('open_dispute', () => {
    it('holds for a card purchase with a card authorization output', () => {
      expect(codesOf(resolutionOf())).toEqual([]);
    });

    it('fails a card purchase seen only as a list row', () => {
      expect(
        codesOf(resolutionOf(), [
          customerSeen,
          listed(cardRow()),
          searched(policyChunk()),
        ]),
      ).toEqual(['ACTION_UNSUPPORTED']);
    });

    it('holds for an outgoing SPEI settled past the policy window', () => {
      expect(
        codesOf(
          withAction({ transaction_ids: [SPEI_TX] }),
          speiDisputeRun(hoursBefore(SPEI_DISPUTE_AFTER_HOURS)),
        ),
      ).toEqual([]);
    });

    it('fails an outgoing SPEI inside the window or seen only as a row', () => {
      expect(
        codesOf(
          withAction({ transaction_ids: [SPEI_TX] }),
          speiDisputeRun(hoursBefore(SPEI_DISPUTE_AFTER_HOURS - 1)),
        ),
      ).toEqual(['ACTION_UNSUPPORTED']);
      expect(codesOf(withAction({ transaction_ids: [SPEI_TX] }))).toEqual([
        'ACTION_UNSUPPORTED',
      ]);
    });
  });

  describe('resend_cep', () => {
    const resend = proposing({
      type: 'resend_cep',
      transaction_ids: [SPEI_TX],
      reason_code: 'customer_requested_receipt',
    });

    it('holds for a seen settled status with a CEP available', () => {
      expect(
        codesOf(resend, [
          ...CARD_DISPUTE_RUN,
          { tool: 'get_spei_status', output: speiStatus() },
        ]),
      ).toEqual([]);
    });

    it('fails without a seen settled status or without a CEP', () => {
      expect(codesOf(resend)).toEqual(['ACTION_UNSUPPORTED']);
      expect(
        codesOf(resend, [
          ...CARD_DISPUTE_RUN,
          {
            tool: 'get_spei_status',
            output: speiStatus({ cep_available: false }),
          },
        ]),
      ).toEqual(['ACTION_UNSUPPORTED']);
    });
  });

  describe('escalate_fraud', () => {
    const escalate = proposing(ESCALATE);

    it('fails without a code-produced fraud signal', () => {
      expect(codesOf(escalate)).toEqual(['ACTION_UNSUPPORTED']);
    });

    it('holds on a seen fraud_review hold', () => {
      expect(
        codesOf(escalate, [
          ...CARD_DISPUTE_RUN,
          {
            tool: 'get_spei_status',
            output: speiStatus({
              status: 'pending',
              settled_at: null,
              hold_reason: 'fraud_review',
            }),
          },
        ]),
      ).toEqual([]);
    });

    it('holds on a seen card_blocked_fraud decline', () => {
      expect(
        codesOf(escalate, [
          customerSeen,
          searched(policyChunk()),
          {
            tool: 'get_card_authorization',
            output: cardAuth({
              status: 'rejected',
              decision: 'declined',
              decline_reason: 'card_blocked_fraud',
            }),
          },
        ]),
      ).toEqual([]);
    });

    it('holds on three card-not-present charges at one merchant within 24 h', () => {
      const burstEscalate = { ...escalate, evidence: [] };
      const run = (rows: ReturnType<typeof cnpRows>) => [
        customerSeen,
        searched(policyChunk()),
        listed(...rows),
      ];
      expect(
        codesOf(
          burstEscalate,
          run(cnpRows([hoursBefore(30), hoursBefore(20), hoursBefore(7)])),
        ),
      ).toEqual([]);
      expect(
        codesOf(
          burstEscalate,
          run(cnpRows([hoursBefore(50), hoursBefore(20), hoursBefore(7)])),
        ),
      ).toEqual(['ACTION_UNSUPPORTED']);
      expect(
        codesOf(
          burstEscalate,
          run([
            ...cnpRows([hoursBefore(9), hoursBefore(8)]),
            cardRow({
              id: 'tx_b009',
              created_at: hoursBefore(7),
              merchant_descriptor: 'OTRO COMERCIO',
            }),
          ]),
        ),
      ).toEqual(['ACTION_UNSUPPORTED']);
      expect(
        codesOf(
          burstEscalate,
          run(
            cnpRows([hoursBefore(9), hoursBefore(8), hoursBefore(7)]).map(
              (row) => ({ ...row, channel: 'card_present' as const }),
            ),
          ),
        ),
      ).toEqual(['ACTION_UNSUPPORTED']);
    });

    it('reads a burst at exactly 24 h from unsorted rows, each id once', () => {
      const burstEscalate = { ...escalate, evidence: [] };
      const [first, second, third] = cnpRows([
        hoursBefore(31),
        hoursBefore(7),
        hoursBefore(30),
      ]);
      const run = (...results: ToolResult[]) => [
        customerSeen,
        searched(policyChunk()),
        ...results,
      ];
      expect(
        codesOf(burstEscalate, run(listed(first!, second!, third!))),
      ).toEqual([]);
      expect(
        codesOf(burstEscalate, run(listed(first!, second!), listed(first!))),
      ).toEqual(['ACTION_UNSUPPORTED']);
      expect(
        codesOf(
          burstEscalate,
          run(
            listed(
              ...cnpRows([hoursBefore(7), hoursBefore(20), hoursBefore(60)]),
            ),
          ),
        ),
      ).toEqual(['ACTION_UNSUPPORTED']);
    });

    it('holds on the intake injection flag or a cross-customer lookup', () => {
      expect(
        codesIn(escalate, runOf(CARD_DISPUTE_RUN, { injectionSignal: true })),
      ).toEqual([]);
      expect(
        codesIn(
          escalate,
          runOf(CARD_DISPUTE_RUN, { crossCustomerLookup: true }),
        ),
      ).toEqual([]);
    });
  });

  it('is not checked when the action is already outside the G2 table', () => {
    expect(
      codesOf(proposing({ type: 'resend_cep', transaction_ids: [CARD_TX] })),
    ).toEqual(['ACTION_NOT_ALLOWED']);
  });
});

describe('factFlags', () => {
  const NONE: Partial<Resolution['proposed_action']> = {
    type: 'none',
    transaction_ids: [],
    reason_code: 'insufficient_information',
  };
  const flagsOf = (
    resolution: Resolution,
    toolResults: ToolResult[] = CARD_DISPUTE_RUN,
    priorOpenDisputes = 0,
  ) =>
    factFlags(resolution, buildEvidence(runOf(toolResults)), {
      priorOpenDisputes,
    });

  it('sets action_fact_mismatch on none over a disputable card charge', () => {
    expect(flagsOf(proposing(NONE))).toEqual(['action_fact_mismatch']);
  });

  it('sets action_fact_mismatch on none over a fraud decline or a burst', () => {
    const general = {
      ...proposing(NONE),
      category: 'general_inquiry' as const,
    };
    expect(
      flagsOf(general, [
        {
          tool: 'get_card_authorization',
          output: cardAuth({
            status: 'rejected',
            decision: 'declined',
            decline_reason: 'card_blocked_fraud',
          }),
        },
      ]),
    ).toEqual(['action_fact_mismatch']);
    expect(
      flagsOf(general, [
        listed(...cnpRows([hoursBefore(9), hoursBefore(8), hoursBefore(7)])),
      ]),
    ).toEqual(['action_fact_mismatch']);
  });

  it('leaves action_fact_mismatch unset when the facts do not call for an action', () => {
    expect(
      flagsOf(proposing(NONE), [
        {
          tool: 'get_card_authorization',
          output: cardAuth({ auth_factors: 2 }),
        },
      ]),
    ).toEqual([]);
    expect(
      flagsOf({ ...proposing(NONE), category: 'general_inquiry' }),
    ).toEqual([]);
    expect(flagsOf(resolutionOf())).toEqual([]);
  });

  it('sets first_party_signal on a dispute of a two-factor purchase', () => {
    expect(
      flagsOf(resolutionOf(), [
        {
          tool: 'get_card_authorization',
          output: cardAuth({ auth_factors: 2 }),
        },
      ]),
    ).toEqual(['first_party_signal']);
  });

  it('sets first_party_signal from three prior disputes, not from two', () => {
    expect(flagsOf(resolutionOf(), CARD_DISPUTE_RUN, 3)).toEqual([
      'first_party_signal',
    ]);
    expect(flagsOf(resolutionOf(), CARD_DISPUTE_RUN, 2)).toEqual([]);
  });
});
