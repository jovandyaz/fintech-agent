import type {
  CaseCategory,
  CaseFlag,
  ProposedAction,
  Resolution,
} from '@fintech-agent/contracts';

type Citation = Resolution['citations'][number];

/** The six defects of 02 G3 a canary carries, each one the validator cannot catch by construction. */
export const CANARY_DEFECTS = [
  'wrong_transaction',
  'none_on_disputable',
  'wrong_supported_action',
  'misstated_policy',
  'wrong_category',
  'cold_tone',
] as const;
export type CanaryDefect = (typeof CANARY_DEFECTS)[number];

/** What a canary inserts; it must read exactly like a real agent proposal. */
export interface CanarySeed {
  customerId: string;
  category: CaseCategory;
  text: string;
  draftReply: string;
  reasoningSummary: string;
  /** Real chunks of `data/policies`, quoted verbatim, as a real proposal cites them. */
  citations: Citation[];
  /** The flags Persist would compute for this action on this data (01). */
  flags: CaseFlag[];
  action: ProposedAction;
}

export interface CanaryTemplate {
  defect: CanaryDefect;
  seed: CanarySeed;
}

const UNRECOGNIZED_CHARGE = [
  '¿Y este cobro de dónde salió? Veo 899 de un PAYPAL que no me suena de nada.',
  'Me apareció un cargo de PAYPAL por 899 que yo no hice, ¿qué es?',
  'Hola, no reconozco una compra de PAYPAL de 899 en mi tarjeta.',
  'Tengo un cargo raro de PAYPAL, 899 pesos, nunca compré eso.',
] as const;
const SPEI_NOT_RECEIVED = [
  'Mandé un SPEI de 12,000 el viernes y la persona dice que no le llegó. ¿Lo pueden cancelar?',
  'Transferí 12,000 por SPEI y el beneficiario no lo ve, necesito el comprobante.',
] as const;
const DISPUTE_REPLY =
  'Hola, registramos tu aclaración por el cargo que no reconoces con folio {{folio}}. Te responderemos por escrito a más tardar el {{fecha_limite_dictamen}}.';

const DICTAMEN: Citation = {
  chunk_id: 'chunk_p03s2',
  doc_id: 'pol-03',
  section: 'Dictamen',
  quote: 'entrega al cliente un dictamen por escrito',
};
const CARD_CREDIT: Citation = {
  chunk_id: 'chunk_p04s1',
  doc_id: 'pol-04',
  section: 'Abono por un cargo no reconocido',
  quote: 'con su reporte basta para abrir la aclaración',
};
const SPEI_DISPUTE: Citation = {
  chunk_id: 'chunk_p01s3',
  doc_id: 'pol-01',
  section: 'Cuándo procede una aclaración por un SPEI enviado',
  quote:
    'el banco abre una disputa con el banco receptor por un SPEI liquidado',
};
const MERCHANT_DESCRIPTOR: Citation = {
  chunk_id: 'chunk_p04s2',
  doc_id: 'pol-04',
  section: 'Cómo se identifica el comercio',
  quote: 'puede no coincidir con la marca que el cliente conoce',
};
const CEP: Citation = {
  chunk_id: 'chunk_p02s3',
  doc_id: 'pol-02',
  section: 'Comprobante electrónico de pago (CEP)',
  quote: 'permite al beneficiario comprobar ante su banco que el pago llegó',
};

// Built on the CARD-UNREC-01 and SPEI-OUT-02 scenarios of data/scenarios.ts
// (cus_07 and cus_02), so every transaction exists and belongs to the customer.
export const CANARY_TEMPLATES: readonly CanaryTemplate[] = [
  {
    defect: 'wrong_transaction',
    seed: {
      customerId: 'cus_07',
      category: 'unrecognized_card_charge',
      text: UNRECOGNIZED_CHARGE[0],
      draftReply: DISPUTE_REPLY,
      reasoningSummary:
        'El cliente no reconoce un cargo con tarjeta no presente de un comercio en línea.',
      citations: [CARD_CREDIT, DICTAMEN],
      flags: ['first_party_signal'],
      action: {
        type: 'open_dispute',
        transaction_ids: ['tx_f059'],
        reason_code: 'unrecognized_charge',
        justification:
          'Cargo no reconocido con un solo factor de autenticación.',
      },
    },
  },
  {
    defect: 'none_on_disputable',
    seed: {
      customerId: 'cus_07',
      category: 'unrecognized_card_charge',
      text: UNRECOGNIZED_CHARGE[1],
      draftReply:
        'Hola, revisamos el cargo y corresponde a una compra en línea. Si tienes dudas, escríbenos de nuevo.',
      reasoningSummary:
        'El cargo aparece liquidado con un comercio en línea registrado.',
      citations: [MERCHANT_DESCRIPTOR],
      flags: ['action_fact_mismatch'],
      action: {
        type: 'none',
        transaction_ids: [],
        reason_code: 'informational',
        justification: 'El movimiento aparece liquidado.',
      },
    },
  },
  {
    defect: 'wrong_supported_action',
    seed: {
      customerId: 'cus_02',
      category: 'spei_outgoing_not_received',
      text: SPEI_NOT_RECEIVED[0],
      draftReply:
        'Hola, registramos una aclaración por tu transferencia con folio {{folio}}. Te responderemos por escrito a más tardar el {{fecha_limite_dictamen}}.',
      reasoningSummary:
        'La transferencia aparece liquidada y el beneficiario dice no haberla recibido.',
      citations: [SPEI_DISPUTE],
      flags: [],
      action: {
        type: 'open_dispute',
        transaction_ids: ['tx_so02a'],
        reason_code: 'spei_not_received_after_window',
        justification:
          'Transferencia liquidada que el beneficiario no reconoce.',
      },
    },
  },
  {
    defect: 'misstated_policy',
    seed: {
      customerId: 'cus_02',
      category: 'spei_outgoing_not_received',
      text: SPEI_NOT_RECEIVED[1],
      draftReply:
        'Hola, tu transferencia quedó liquidada. Las transferencias SPEI pueden tardar varios días hábiles en reflejarse; te reenviamos el comprobante para que lo compartas.',
      reasoningSummary:
        'La transferencia está liquidada y el comprobante está disponible.',
      citations: [CEP],
      flags: [],
      action: {
        type: 'resend_cep',
        transaction_ids: ['tx_so02a'],
        reason_code: 'customer_requested_receipt',
        justification: 'Transferencia liquidada con comprobante disponible.',
      },
    },
  },
  {
    defect: 'wrong_category',
    seed: {
      customerId: 'cus_07',
      category: 'spei_outgoing_not_received',
      text: UNRECOGNIZED_CHARGE[2],
      draftReply: DISPUTE_REPLY,
      reasoningSummary:
        'El cliente no reconoce un cargo con tarjeta no presente y un solo factor de autenticación.',
      citations: [CARD_CREDIT, DICTAMEN],
      flags: [],
      action: {
        type: 'open_dispute',
        transaction_ids: ['tx_cu01a'],
        reason_code: 'unrecognized_charge',
        justification:
          'Cargo no reconocido con un solo factor de autenticación.',
      },
    },
  },
  {
    defect: 'cold_tone',
    seed: {
      customerId: 'cus_07',
      category: 'unrecognized_card_charge',
      text: UNRECOGNIZED_CHARGE[3],
      draftReply:
        'Aclaración registrada con folio {{folio}}. Espera la respuesta en el plazo de ley.',
      reasoningSummary:
        'El cliente no reconoce un cargo con tarjeta no presente y un solo factor de autenticación.',
      citations: [CARD_CREDIT, DICTAMEN],
      flags: [],
      action: {
        type: 'open_dispute',
        transaction_ids: ['tx_cu01a'],
        reason_code: 'unrecognized_charge',
        justification:
          'Cargo no reconocido con un solo factor de autenticación.',
      },
    },
  },
];
