import { describe, expect, it } from 'vitest';

import {
  DecisionSchema,
  ResolutionSchema,
  WebhookEventSchema,
} from './schemas.js';

const validResolution = {
  category: 'unrecognized_card_charge',
  draft_reply: 'Registramos tu aclaración con folio {{folio}}.',
  citations: [{ chunk_id: 'pol-04#2', doc_id: 'pol-04', section: 'Plazos' }],
  abstained: false,
  evidence: [{ kind: 'card_auth', id: 'tx_0412' }],
  proposed_action: {
    type: 'open_dispute',
    transaction_ids: ['tx_0412'],
    reason_code: 'unrecognized_charge',
    justification: 'Cargo liquidado sin 3DS que el cliente no reconoce.',
  },
  reasoning_summary: 'Cargo de comercio desconocido, un solo factor.',
};

describe('ResolutionSchema (G2: closed, value-free actions)', () => {
  it('accepts a well-formed resolution', () => {
    expect(ResolutionSchema.safeParse(validResolution).success).toBe(true);
  });

  it('rejects an action type outside the closed set, such as a refund', () => {
    const refund = {
      ...validResolution,
      proposed_action: { ...validResolution.proposed_action, type: 'refund' },
    };
    expect(ResolutionSchema.safeParse(refund).success).toBe(false);
  });

  it('rejects any extra field on the action, such as an amount or a CLABE', () => {
    for (const extra of [
      { amount: 5000 },
      { clabe: '012180001234567891' },
      { instructions: 'transfer now' },
    ]) {
      const withExtra = {
        ...validResolution,
        proposed_action: { ...validResolution.proposed_action, ...extra },
      };
      expect(ResolutionSchema.safeParse(withExtra).success).toBe(false);
    }
  });

  it('rejects extra top-level fields', () => {
    expect(
      ResolutionSchema.safeParse({ ...validResolution, customer_id: 'c_02' })
        .success,
    ).toBe(false);
  });

  it('rejects a category outside the closed set', () => {
    expect(
      ResolutionSchema.safeParse({ ...validResolution, category: 'refund' })
        .success,
    ).toBe(false);
  });
});

describe('DecisionSchema', () => {
  const base = {
    operator: 'ops.maria',
    final_reply: 'Hola, ya registramos tu aclaración.',
    acknowledged_flags: [],
  };

  it('accepts an approve', () => {
    expect(
      DecisionSchema.safeParse({ ...base, decision: 'approve' }).success,
    ).toBe(true);
  });

  it('requires a reject code on a reject', () => {
    expect(
      DecisionSchema.safeParse({ ...base, decision: 'reject' }).success,
    ).toBe(false);
    expect(
      DecisionSchema.safeParse({
        ...base,
        decision: 'reject',
        reject_code: 'wrong_action',
      }).success,
    ).toBe(true);
  });

  it('rejects a flag outside the closed set', () => {
    expect(
      DecisionSchema.safeParse({
        ...base,
        decision: 'approve',
        acknowledged_flags: ['looks_fine'],
      }).success,
    ).toBe(false);
  });

  it('requires a final reply even on a reject', () => {
    expect(
      DecisionSchema.safeParse({
        operator: 'ops.maria',
        decision: 'reject',
        reject_code: 'tone',
        acknowledged_flags: [],
      }).success,
    ).toBe(false);
  });
});

describe('WebhookEventSchema', () => {
  const event = {
    event_id: 'evt_001',
    ticket_id: 'tkt_001',
    customer_id: 'c_01',
    text: 'Mandé un SPEI y no llegó',
    created_at: '2026-10-05T10:00:00Z',
  };

  it('accepts a ticket event', () => {
    expect(WebhookEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejects an empty text or a non-ISO timestamp', () => {
    expect(WebhookEventSchema.safeParse({ ...event, text: '' }).success).toBe(
      false,
    );
    expect(
      WebhookEventSchema.safeParse({ ...event, created_at: 'ayer' }).success,
    ).toBe(false);
  });
});
