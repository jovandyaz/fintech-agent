import type {
  ActionType,
  CaseCategory,
  ReasonCode,
} from '@fintech-agent/contracts';

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
  action: {
    type: ActionType;
    transaction_ids: string[];
    reason_code: ReasonCode;
    justification: string;
  };
}

export interface CanaryTemplate {
  defect: CanaryDefect;
  seed: CanarySeed;
}

const UNRECOGNIZED_CHARGE =
  '¿Y este cobro de dónde salió? Veo 899 de un PAYPAL que no me suena de nada.';
const SPEI_NOT_RECEIVED =
  'Mandé un SPEI de 12,000 el viernes y la persona dice que no le llegó. ¿Lo pueden cancelar?';
const DISPUTE_REPLY =
  'Hola, registramos tu aclaración por el cargo que no reconoces con folio {{folio}}. Te responderemos por escrito a más tardar el {{fecha_limite_dictamen}}.';

// Built on the CARD-UNREC-01 and SPEI-OUT-02 scenarios of data/scenarios.ts
// (cus_07 and cus_02), so every transaction exists and belongs to the customer.
export const CANARY_TEMPLATES: readonly CanaryTemplate[] = [
  {
    defect: 'wrong_transaction',
    seed: {
      customerId: 'cus_07',
      category: 'unrecognized_card_charge',
      text: UNRECOGNIZED_CHARGE,
      draftReply: DISPUTE_REPLY,
      reasoningSummary:
        'El cliente no reconoce un cargo con tarjeta no presente y un solo factor de autenticación.',
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
      text: UNRECOGNIZED_CHARGE,
      draftReply:
        'Hola, revisamos el cargo y corresponde a una compra en línea. Si tienes dudas, escríbenos de nuevo.',
      reasoningSummary:
        'El cargo aparece liquidado con un comercio en línea registrado.',
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
      text: SPEI_NOT_RECEIVED,
      draftReply:
        'Hola, registramos una aclaración por tu transferencia con folio {{folio}}. Te responderemos por escrito a más tardar el {{fecha_limite_dictamen}}.',
      reasoningSummary:
        'La transferencia aparece liquidada y el beneficiario dice no haberla recibido.',
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
      text: SPEI_NOT_RECEIVED,
      draftReply:
        'Hola, tu transferencia quedó liquidada. Las transferencias SPEI pueden tardar hasta 72 horas en reflejarse; te reenviamos el comprobante para que lo compartas.',
      reasoningSummary:
        'La transferencia está liquidada y el comprobante está disponible.',
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
      text: UNRECOGNIZED_CHARGE,
      draftReply: DISPUTE_REPLY,
      reasoningSummary:
        'El cliente no reconoce un cargo con tarjeta no presente y un solo factor de autenticación.',
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
      text: UNRECOGNIZED_CHARGE,
      draftReply:
        'Aclaración registrada con folio {{folio}}. Espera la respuesta en el plazo de ley.',
      reasoningSummary:
        'El cliente no reconoce un cargo con tarjeta no presente y un solo factor de autenticación.',
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
