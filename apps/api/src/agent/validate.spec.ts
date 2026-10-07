import type { Resolution } from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import {
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
import { buildEvidence, type ToolResult } from './core/validate/evidence.js';
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
