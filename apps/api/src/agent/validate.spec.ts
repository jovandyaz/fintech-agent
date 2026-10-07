import {
  MAX_REPLY_CHARS,
  MS_PER_HOUR,
  SPEI_DISPUTE_AFTER_HOURS,
  type Resolution,
} from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import {
  NOW,
  RECEIVED_AT,
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
import { fastestRunMs } from '../../test/timing.js';
import { replyViolations } from '../replies/reply-checks.js';
import { CalendarRangeError } from './core/calendar.js';
import {
  buildEvidence,
  type RunFacts,
  type ToolResult,
} from './core/validate/evidence.js';
import { factFlags } from './core/validate/flags.js';
import { validate } from './core/validate/index.js';
import { fillPlaceholders } from './core/validate/placeholders.js';
import {
  RepairEvidenceError,
  validateWithRepair,
} from './core/validate/repair.js';
import type { ChunkStateRules } from './core/validate/state-rules.js';

const CARD_DISPUTE_RUN: ToolResult[] = [
  customerSeen,
  listed(cardRow(), speiRow()),
  { tool: 'get_card_authorization', output: cardAuth() },
  searched(policyChunk()),
];

const codesOf = (
  raw: unknown,
  toolResults: ToolResult[] = CARD_DISPUTE_RUN,
  facts: Partial<Omit<RunFacts, 'toolResults'>> = {},
): readonly string[] => {
  const outcome = validate(raw, {
    evidence: buildEvidence(runOf(toolResults, facts)),
    stateRules: [],
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
        stateRules: [],
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
        codesOf(escalate, CARD_DISPUTE_RUN, { injectionSignal: true }),
      ).toEqual([]);
      expect(
        codesOf(escalate, CARD_DISPUTE_RUN, { crossCustomerLookup: true }),
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
    resolution: Pick<Resolution, 'proposed_action'> & {
      category: Resolution['category'] | null;
    },
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

  it('reads a fallback, which has no category, as a possible unrecognized charge', () => {
    const fallback = {
      category: null,
      proposed_action: proposing(NONE).proposed_action,
    };
    expect(flagsOf(fallback)).toEqual(['action_fact_mismatch']);
    expect(
      flagsOf(fallback, [
        listed(...cnpRows([hoursBefore(9), hoursBefore(8), hoursBefore(7)])),
      ]),
    ).toEqual(['action_fact_mismatch']);
    expect(flagsOf(fallback, [customerSeen])).toEqual([]);
  });

  it('sets first_party_signal from prior disputes whatever the action', () => {
    expect(flagsOf(proposing(NONE), CARD_DISPUTE_RUN, 3)).toEqual([
      'action_fact_mismatch',
      'first_party_signal',
    ]);
  });

  it('sets first_party_signal from three prior disputes, not from two', () => {
    expect(flagsOf(resolutionOf(), CARD_DISPUTE_RUN, 3)).toEqual([
      'first_party_signal',
    ]);
    expect(flagsOf(resolutionOf(), CARD_DISPUTE_RUN, 2)).toEqual([]);
  });
});

const replying = (draft_reply: string): Resolution =>
  resolutionOf({ draft_reply });

describe('reply checks', () => {
  it('fails a Markdown image in the reply (LINK_IN_REPLY)', () => {
    expect(
      codesOf(replying('Mira aquí: ![x](https://evil.example/p.png?d=1)')),
    ).toEqual(['LINK_IN_REPLY']);
  });

  it('fails a request for the CVV (AUTH_FACTOR_REQUEST)', () => {
    expect(
      codesOf(replying('Para continuar, compártenos el CVV de tu tarjeta.')),
    ).toEqual(['AUTH_FACTOR_REQUEST']);
  });

  it('fails a CLABE in the reply (PII_IN_REPLY)', () => {
    expect(
      codesOf(replying('Tu cuenta 002010077777777771 está activa.')),
    ).toContain('PII_IN_REPLY');
  });
});

describe('UNGROUNDED_NUMBER', () => {
  it('fails "$5,000" that only the customer wrote', () => {
    expect(
      codesOf(replying('Revisamos el cargo de $5,000 que mencionas.')),
    ).toEqual(['UNGROUNDED_NUMBER']);
  });

  it('accepts an amount and a date from a tool output', () => {
    expect(
      codesOf(replying('Revisamos el cargo de $1,299.50 del 5 de octubre.')),
    ).toEqual([]);
  });

  it('grounds on cited chunks, never on a retrieved chunk left uncited', () => {
    expect(codesOf(replying('El dictamen se entrega en 45 días.'))).toEqual([]);
    const uncited = policyChunk({
      chunk_id: 'chunk_p05s1',
      doc_id: 'pol-05',
      section: 'Comisiones',
      content: 'La comisión por aclaración improcedente es de 3%.',
    });
    expect(
      codesOf(replying('Podría aplicar una comisión de 3%.'), [
        ...CARD_DISPUTE_RUN,
        searched(uncited),
      ]),
    ).toEqual(['UNGROUNDED_NUMBER']);
  });

  it.each([
    'Recibirás 5-10 mil pesos.',
    'Recibirás en octubre cinco mil pesos.',
    'Recibirás 2000 de vuelta.',
    'Recibirás…5000 de vuelta.',
    'Te llegan 50 libras.',
    'Lo revisamos durante 2031.',
    'Tu tarjeta terminación 9999 quedó revisada.',
  ])('fails closed on "%s", which nothing grounds', (draft) => {
    expect(codesOf(replying(draft))).toEqual(['UNGROUNDED_NUMBER']);
  });

  const withChunk = (content: string): ToolResult[] => [
    ...CARD_DISPUTE_RUN.slice(0, -1),
    searched(policyChunk({ content })),
  ];
  const LAW_CHUNK_RUN = withChunk(
    'Conforme al artículo 23 de la LTOSF y la Circular 14/2017, el abono se hace a más tardar el segundo día hábil.',
  );

  it.each(['El monto es de 23 pesos.', 'Recibirás 2017 de vuelta.'])(
    'never grounds "%s" on an article or circular number of a cited chunk',
    (draft) => {
      expect(codesOf(replying(draft), LAW_CHUNK_RUN)).toEqual([
        'UNGROUNDED_NUMBER',
      ]);
    },
  );

  it('grounds a masked CLABE and an alphanumeric tracking key the run saw', () => {
    const run: ToolResult[] = [
      ...CARD_DISPUTE_RUN,
      {
        tool: 'get_spei_status',
        output: speiStatus({ tracking_key_last4: 'O01A' }),
      },
    ];
    expect(
      codesOf(
        replying('Tu envío a la CLABE ••••7781, rastreo con final O01A.'),
        run,
      ),
    ).toEqual([]);
    expect(codesOf(replying('Tu rastreo con final O02A.'), run)).toEqual([
      'UNGROUNDED_NUMBER',
    ]);
  });

  it('never lets clock minutes hide an amount next to a grounded time', () => {
    const run: ToolResult[] = [
      ...CARD_DISPUTE_RUN,
      {
        tool: 'get_spei_status',
        output: speiStatus({ settled_at: '2026-10-05T21:50:00Z' }),
      },
    ];
    expect(codesOf(replying('Tu envío llegó a las 15 y 50.'), run)).toEqual([]);
    expect(
      codesOf(replying('Tu envío llegó a las 15 y 50 pesos de comisión.'), run),
    ).toEqual(['UNGROUNDED_NUMBER']);
  });

  it('never grounds "1.000 días hábiles" on a chunk that states one day', () => {
    const run = withChunk(
      'El abono se hace a más tardar el segundo día hábil; la respuesta llega en 1 día hábil.',
    );
    expect(
      codesOf(replying('Se resuelve en 1.000 días hábiles.'), run),
    ).toEqual(['UNGROUNDED_NUMBER']);
  });

  const AMOUNT_2500_RUN: ToolResult[] = [
    ...CARD_DISPUTE_RUN,
    listed(speiRow({ amount: 2500 })),
  ];

  it('never grounds "2 500 mil pesos" on an amount of 2,500', () => {
    expect(
      codesOf(
        replying('El monto revisado es de 2 500 mil pesos.'),
        AMOUNT_2500_RUN,
      ),
    ).toEqual(['UNGROUNDED_NUMBER']);
  });

  it('never grounds "2 500 pesos y medio" on an amount of 2,500', () => {
    expect(
      codesOf(
        replying('El monto revisado es de 2 500 pesos y medio.'),
        AMOUNT_2500_RUN,
      ),
    ).toEqual(['UNGROUNDED_NUMBER']);
  });

  it('passes a count of a listed noun and the article "un"', () => {
    expect(codesOf(replying('Revisamos tus 2 cargos en un momento.'))).toEqual(
      [],
    );
  });
});

describe('COMMITMENT_IN_REPLY', () => {
  it('fails "te reembolsaremos" and passes "no podemos hacer un reembolso"', () => {
    expect(codesOf(replying('Tranquila, te reembolsaremos.'))).toEqual([
      'COMMITMENT_IN_REPLY',
    ]);
    expect(
      codesOf(replying('Por ahora no podemos hacer un reembolso.')),
    ).toEqual([]);
  });

  it('renders {{compromiso_abono}} only for a one-factor card dispute', () => {
    const abono = replying('Hola {{nombre}}. {{compromiso_abono}}');
    expect(codesOf(abono)).toEqual([]);
    expect(
      codesOf(abono, [
        ...CARD_DISPUTE_RUN,
        {
          tool: 'get_card_authorization',
          output: cardAuth({ auth_factors: 2 }),
        },
      ]),
    ).toEqual(['COMMITMENT_IN_REPLY']);
  });

  it('renders {{compromiso_dictamen}} only with open_dispute', () => {
    expect(
      codesOf(
        resolutionOf({
          draft_reply: 'Hola {{nombre}}. {{compromiso_dictamen}}',
          proposed_action: {
            type: 'none',
            transaction_ids: [],
            reason_code: 'informational',
            justification: 'Consulta.',
          },
        }),
      ),
    ).toEqual(['COMMITMENT_IN_REPLY']);
  });
});

describe('placeholders', () => {
  it('fails a placeholder outside the approved set (SCHEMA)', () => {
    expect(codesOf(replying('Tu saldo es {{saldo}}.'))).toEqual(['SCHEMA']);
  });

  it('fails {{nombre}} when the run never read the customer', () => {
    expect(
      codesOf(
        replying('Hola {{nombre}}, folio {{folio}}.'),
        CARD_DISPUTE_RUN.filter((result) => result !== customerSeen),
      ),
    ).toEqual(['EVIDENCE_UNSEEN']);
  });
});

describe('POLICY_DATA_CONFLICT', () => {
  const CONFLICT_RULES: ChunkStateRules[] = [
    {
      chunk_id: 'chunk_p02s3',
      quarantined: false,
      rules: [
        {
          id: 'return_credit_same_day',
          applies_to: {
            type: 'spei_out',
            status: 'returned',
            returned_business_days_ago: '>=1',
          },
          requires: { field: 'reversal_credit_id', not_null: true },
        },
      ],
    },
  ];
  const returnedRun: ToolResult[] = [
    ...CARD_DISPUTE_RUN,
    {
      tool: 'get_spei_status',
      output: speiStatus({
        status: 'returned',
        returned_at: '2026-10-02T17:00:00Z',
        return_reason: 'cuenta_inexistente',
      }),
    },
  ];

  it('forces none on a rule of an uncited, unretrieved chunk', () => {
    const outcome = validate(resolutionOf({ draft_reply: NEUTRAL_REPLY }), {
      evidence: buildEvidence(runOf(returnedRun)),
      stateRules: CONFLICT_RULES,
    });
    expect(outcome).toMatchObject({
      ok: true,
      resolution: {
        proposed_action: { type: 'none', transaction_ids: [] },
      },
      conflicts: [
        {
          rule_id: 'return_credit_same_day',
          chunk_id: 'chunk_p02s3',
          transaction_id: SPEI_TX,
          field: 'reversal_credit_id',
        },
      ],
    });
  });

  it('holds the reply to the forced none', () => {
    expect(
      validate(resolutionOf(), {
        evidence: buildEvidence(runOf(returnedRun)),
        stateRules: CONFLICT_RULES,
      }),
    ).toEqual({
      ok: false,
      codes: ['COMMITMENT_IN_REPLY'],
      conflicts: [
        {
          rule_id: 'return_credit_same_day',
          chunk_id: 'chunk_p02s3',
          transaction_id: SPEI_TX,
          field: 'reversal_credit_id',
        },
      ],
    });
  });

  it('carries the conflicts of an output that does not parse', () => {
    expect(
      validate('{"category":', {
        evidence: buildEvidence(runOf(returnedRun)),
        stateRules: CONFLICT_RULES,
      }),
    ).toMatchObject({
      ok: false,
      codes: ['SCHEMA'],
      conflicts: [{ rule_id: 'return_credit_same_day' }],
    });
  });
});

describe('validation time', () => {
  const VALIDATION_BUDGET_MS = 100;
  const ADVERSARIAL_SHAPES = [
    '1',
    '1.',
    '$1',
    '1 mil ',
    'en 1 dias ',
    'no te ',
    'no te devolveremos ',
    '1,111',
    '1 111 ',
    '1 de ',
    'xxxx1',
    'terminacion 1 ',
    '1 millon 1 ',
    'a las 1 ',
    '1:11 ',
    '_1',
    'medio millon ',
    'a las uno y ',
  ];

  it('stays within budget on a maximal adversarial draft', () => {
    for (const shape of ADVERSARIAL_SHAPES) {
      const draft = shape
        .repeat(Math.ceil(MAX_REPLY_CHARS / shape.length))
        .slice(0, MAX_REPLY_CHARS);
      const fastest = fastestRunMs(() =>
        validate(replying(draft), {
          evidence: buildEvidence(runOf(CARD_DISPUTE_RUN)),
          stateRules: [],
        }),
      );
      expect(fastest, shape).toBeLessThan(VALIDATION_BUDGET_MS);
    }
  });
});

describe('date placeholders and their commitments', () => {
  const informational = (draft_reply: string): Resolution =>
    resolutionOf({
      draft_reply,
      proposed_action: {
        type: 'none',
        transaction_ids: [],
        reason_code: 'informational',
        justification: 'Consulta.',
      },
    });

  it('holds a bare deadline to the predicate of its commitment', () => {
    expect(
      codesOf(
        informational(
          'Recibirás tu abono a más tardar el {{fecha_limite_abono}}.',
        ),
      ),
    ).toEqual(['COMMITMENT_IN_REPLY']);
    expect(
      codesOf(informational('Te responderemos el {{fecha_limite_dictamen}}.')),
    ).toEqual(['COMMITMENT_IN_REPLY']);
    expect(
      codesOf(
        replying('Hola {{nombre}}, el abono llega el {{fecha_limite_abono}}.'),
      ),
    ).toEqual([]);
  });

  it('fails a placeholder glued to a letter or a digit (SCHEMA; the digit is an ungrounded figure)', () => {
    expect(codesOf(replying('Ref 12{{fecha_recepcion}} registrada.'))).toEqual([
      'SCHEMA',
      'UNGROUNDED_NUMBER',
    ]);
    expect(codesOf(replying('Folio{{folio}} registrado.'))).toEqual(['SCHEMA']);
  });

  it('fails two placeholders with nothing between them (SCHEMA)', () => {
    expect(
      codesOf(replying('Hola {{nombre}}, folio {{folio}}{{fecha_recepcion}}.')),
    ).toEqual(['SCHEMA']);
  });
});

describe('validate, then fill', () => {
  const DRAFT =
    'Hola {{nombre}}, tu folio es {{folio}}. {{compromiso_dictamen}} {{compromiso_abono}}';
  const FOLIO = 'AC-K7Q3-M9X2';
  const filledFor = (receivedAt: Date): string => {
    const outcome = validate(replying(DRAFT), {
      evidence: buildEvidence(runOf(CARD_DISPUTE_RUN, { receivedAt })),
      stateRules: [],
    });
    if (!outcome.ok) throw new Error(outcome.codes.join(', '));
    return fillPlaceholders(outcome.resolution.draft_reply, {
      receivedAt,
      folio: FOLIO,
      firstName: 'Ana',
    });
  };

  it('fills an accepted draft with the approved wording and its dates', () => {
    const filled = filledFor(RECEIVED_AT);
    expect(filled).toBe(
      'Hola Ana, tu folio es AC-K7Q3-M9X2. Te daremos una respuesta por escrito a más tardar el 21 de noviembre de 2026. Si no estás de acuerdo con ella, puedes acudir a la CONDUSEF. Te abonaremos el importe del cargo a más tardar el 9 de octubre de 2026, mientras resolvemos tu aclaración.',
    );
    expect(replyViolations(filled)).toEqual([]);
  });

  it('skips a weekend and a bank holiday in the credit deadline', () => {
    expect(filledFor(new Date('2026-10-30T18:00:00Z'))).toContain(
      'a más tardar el 4 de noviembre de 2026, mientras',
    );
  });
});

describe('calendar coverage', () => {
  it('throws instead of guessing a business day outside the listed years', () => {
    const lateReturn: ChunkStateRules[] = [
      {
        chunk_id: 'chunk_p02s3',
        quarantined: false,
        rules: [
          {
            id: 'return_credit_same_day',
            applies_to: {
              type: 'spei_out',
              status: 'returned',
              returned_business_days_ago: '>=1',
            },
            requires: { field: 'reversal_credit_id', not_null: true },
          },
        ],
      },
    ];
    expect(() =>
      validate(resolutionOf({ draft_reply: NEUTRAL_REPLY }), {
        evidence: buildEvidence(
          runOf(
            [
              ...CARD_DISPUTE_RUN,
              {
                tool: 'get_spei_status',
                output: speiStatus({
                  status: 'returned',
                  returned_at: '2025-12-30T17:00:00Z',
                }),
              },
            ],
            { receivedAt: new Date('2026-01-02T17:00:00Z') },
          ),
        ),
        stateRules: lateReturn,
      }),
    ).toThrow(CalendarRangeError);
  });
});

describe('repair and fallback', () => {
  const context = (toolResults: ToolResult[] = CARD_DISPUTE_RUN) => ({
    evidence: buildEvidence(runOf(toolResults)),
    stateRules: [],
  });
  const turn = (output: unknown, toolResults = CARD_DISPUTE_RUN) =>
    Promise.resolve({ output, evidence: buildEvidence(runOf(toolResults)) });
  const ungrounded = replying('Revisamos el cargo de $5,000 que mencionas.');

  it('never calls the repair turn when the first output is valid', async () => {
    const repairs: unknown[] = [];
    const outcome = await validateWithRepair(
      resolutionOf(),
      (codes) => {
        repairs.push(codes);
        return turn(resolutionOf());
      },
      context(),
    );
    expect(outcome).toMatchObject({ kind: 'valid', repaired: false });
    expect(repairs).toEqual([]);
  });

  it('gives the repair turn the codes and accepts a valid second output', async () => {
    const repairs: unknown[] = [];
    const outcome = await validateWithRepair(
      ungrounded,
      (codes) => {
        repairs.push(codes);
        return turn(resolutionOf());
      },
      context(),
    );
    expect(repairs).toEqual([['UNGROUNDED_NUMBER']]);
    expect(outcome).toMatchObject({
      kind: 'valid',
      repaired: true,
      resolution: resolutionOf(),
    });
  });

  it('repairs a malformed output with SCHEMA', async () => {
    const repairs: unknown[] = [];
    await validateWithRepair(
      '{"category":',
      (codes) => {
        repairs.push(codes);
        return turn(resolutionOf());
      },
      context(),
    );
    expect(repairs).toEqual([['SCHEMA']]);
  });

  it('falls back to none after a second failure, with one repair only', async () => {
    let repairs = 0;
    const outcome = await validateWithRepair(
      ungrounded,
      () => {
        repairs += 1;
        return turn(replying('Tranquila, te reembolsaremos.'));
      },
      context(),
    );
    expect(repairs).toBe(1);
    expect(outcome).toEqual({
      kind: 'fallback',
      codes: ['COMMITMENT_IN_REPLY'],
      action: {
        type: 'none',
        transaction_ids: [],
        reason_code: 'insufficient_information',
        justification:
          'Validation failed after one repair: COMMITMENT_IN_REPLY',
      },
      conflicts: [],
      evidence: buildEvidence(runOf(CARD_DISPUTE_RUN)),
    });
  });

  it('validates the repair against the evidence of the run so far', async () => {
    const beforeSearch = CARD_DISPUTE_RUN.filter(
      ({ tool }) => tool !== 'search_policies',
    );
    expect(codesOf(resolutionOf(), beforeSearch)).toEqual(['CITATION_UNSEEN']);
    const outcome = await validateWithRepair(
      resolutionOf(),
      () => turn(resolutionOf(), CARD_DISPUTE_RUN),
      context(beforeSearch),
    );
    expect(outcome).toMatchObject({ kind: 'valid', repaired: true });
  });

  const returnedRun: ToolResult[] = [
    ...CARD_DISPUTE_RUN,
    {
      tool: 'get_spei_status',
      output: speiStatus({
        status: 'returned',
        returned_at: '2026-10-02T17:00:00Z',
      }),
    },
  ];
  const returnCreditRules: ChunkStateRules[] = [
    {
      chunk_id: 'chunk_p02s3',
      quarantined: false,
      rules: [
        {
          id: 'return_credit_same_day',
          applies_to: { type: 'spei_out', status: 'returned' },
          requires: { field: 'reversal_credit_id', not_null: true },
        },
      ],
    },
  ];

  it('hands Persist the evidence the accepted or failed verdict used', async () => {
    const fresh = buildEvidence(runOf(CARD_DISPUTE_RUN));
    const initial = context();
    const valid = await validateWithRepair(
      resolutionOf(),
      () => Promise.resolve({ output: resolutionOf(), evidence: fresh }),
      initial,
    );
    expect(valid.evidence).toBe(initial.evidence);
    const repaired = await validateWithRepair(
      ungrounded,
      () => Promise.resolve({ output: resolutionOf(), evidence: fresh }),
      initial,
    );
    expect(repaired.evidence).toBe(fresh);
    const fallback = await validateWithRepair(
      ungrounded,
      () => Promise.resolve({ output: ungrounded, evidence: fresh }),
      initial,
    );
    expect(fallback.evidence).toBe(fresh);
  });

  it('refuses repair evidence that drops what the first turn saw', async () => {
    const withoutSpei = CARD_DISPUTE_RUN.map((result) =>
      result.tool === 'list_transactions' ? listed(cardRow()) : result,
    );
    await expect(
      validateWithRepair(
        ungrounded,
        () => turn(resolutionOf(), withoutSpei),
        context(),
      ),
    ).rejects.toThrow(RepairEvidenceError);
    await expect(
      validateWithRepair(ungrounded, () => turn(resolutionOf()), {
        evidence: buildEvidence(
          runOf(CARD_DISPUTE_RUN, { injectionSignal: true }),
        ),
        stateRules: [],
      }),
    ).rejects.toThrow(RepairEvidenceError);
  });

  it.each([
    ['a SPEI status', 'get_spei_status'],
    ['a card authorization', 'get_card_authorization'],
    ['a policy chunk', 'search_policies'],
    ['the customer', 'get_customer'],
  ])('refuses repair evidence that drops %s', async (_, tool) => {
    const firstTurn: ToolResult[] = [
      ...CARD_DISPUTE_RUN,
      { tool: 'get_spei_status', output: speiStatus() },
    ];
    await expect(
      validateWithRepair(
        ungrounded,
        () =>
          turn(
            resolutionOf(),
            firstTurn.filter((result) => result.tool !== tool),
          ),
        context(firstTurn),
      ),
    ).rejects.toThrow(RepairEvidenceError);
  });

  it('refuses repair evidence that drops a cross-customer lookup', async () => {
    await expect(
      validateWithRepair(ungrounded, () => turn(resolutionOf()), {
        evidence: buildEvidence(
          runOf(CARD_DISPUTE_RUN, { crossCustomerLookup: true }),
        ),
        stateRules: [],
      }),
    ).rejects.toThrow(RepairEvidenceError);
  });

  it('keeps the policy conflicts of the run on a fallback', async () => {
    const outcome = await validateWithRepair(
      ungrounded,
      () => turn(ungrounded, returnedRun),
      {
        evidence: buildEvidence(runOf(returnedRun)),
        stateRules: returnCreditRules,
      },
    );
    expect(outcome).toMatchObject({
      kind: 'fallback',
      conflicts: [
        { rule_id: 'return_credit_same_day', transaction_id: SPEI_TX },
      ],
    });
  });

  it('flags a conflict first seen in the repair turn on a fallback', async () => {
    const outcome = await validateWithRepair(
      ungrounded,
      () => turn(ungrounded, returnedRun),
      {
        evidence: buildEvidence(runOf(CARD_DISPUTE_RUN)),
        stateRules: returnCreditRules,
      },
    );
    expect(outcome).toMatchObject({
      kind: 'fallback',
      conflicts: [{ rule_id: 'return_credit_same_day' }],
    });
  });
});
