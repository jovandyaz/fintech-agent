import {
  APPROVED_FACTOR_WARNINGS,
  CARD_TYPES,
  maskPii,
  type CaseCategory,
  type CaseFlag,
  type ListTransactionsInputSchema,
  type McpToolName,
  type ProposedAction,
  type Resolution,
} from '@fintech-agent/contracts';
import type { z } from 'zod';

type Citation = Resolution['citations'][number];

/** The MCP tools that read one transaction's state, as an investigation calls them. */
export type LookupTool = Extract<
  McpToolName,
  'get_card_authorization' | 'get_spei_status'
>;

/** `list_transactions` input as a model writes it, before the server fills its defaults. */
export type ListFilter = z.input<typeof ListTransactionsInputSchema>;

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

/** A policy chunk a canary cites, and the phrases its agent searches for it with. */
export interface CitedPolicy {
  /** A real chunk of `data/policies`, quoted verbatim, as a real proposal cites it. */
  citation: Citation;
  /** Ways of asking `search_policies` for it, never the section title itself; a run draws one. */
  queries: readonly string[];
}

/** The movement a canary is about, worded with its amount and party as the tools print them. */
export interface CanaryMovement {
  noun: 'el cargo' | 'la compra' | 'la transferencia';
  amount: string;
  /** The merchant or counterparty, with its preposition: `en UBER *TRIP`, `a María`. */
  at: string;
}

/** What a canary inserts; it must read exactly like a real agent proposal. */
export interface CanarySeed {
  customerId: string;
  category: CaseCategory;
  /** Ways the customer words the case; each injection draws one. */
  texts: readonly string[];
  /** Names `movement.amount`, which a drawn run misreads first. */
  draftReply: string;
  movement: CanaryMovement;
  /** What a drawn run's first answer prints for `movement.amount`, so the validator sends it back. */
  misreadAmount: string;
  reasoningSummary: string;
  policies: readonly CitedPolicy[];
  /** The flags Persist would compute for this action on this data (01). */
  flags: CaseFlag[];
  action: ProposedAction;
  /** How the investigation narrows the customer's movements, as real runs always do. */
  listFilter: ListFilter;
  /** The transactions the investigation reads, and with which tool. */
  lookups: { tool: LookupTool; transaction_id: string }[];
}

export interface CanaryTemplate {
  defect: CanaryDefect;
  seed: CanarySeed;
}

/** What the worker holds of a canary's case: its marker's defect, its customer and its stored text. */
export interface CanaryCase {
  defect: CanaryDefect;
  customerId: string;
  textMasked: string;
}

const [NEVER_ASKED, NEVER_SHARE] = APPROVED_FACTOR_WARNINGS;

const DICTAMEN: CitedPolicy = {
  citation: {
    chunk_id: 'chunk_p03s2',
    doc_id: 'pol-03',
    section: 'Dictamen',
    quote: 'entrega al cliente un dictamen por escrito',
  },
  queries: [
    'plazo del dictamen de una aclaración',
    'respuesta por escrito a una aclaración del cliente',
    'cuándo se entrega el dictamen de la aclaración',
  ],
};
const CARD_CREDIT: CitedPolicy = {
  citation: {
    chunk_id: 'chunk_p04s1',
    doc_id: 'pol-04',
    section: 'Abono por un cargo no reconocido',
    quote: 'con su reporte basta para abrir la aclaración',
  },
  queries: [
    'cliente no reconoce un cargo con su tarjeta',
    'abono de un cargo con tarjeta no reconocido y factores de autenticación',
    'qué procede cuando el cliente desconoce un cargo con tarjeta',
  ],
};
const MERCHANT_DESCRIPTOR: CitedPolicy = {
  citation: {
    chunk_id: 'chunk_p04s2',
    doc_id: 'pol-04',
    section: 'Cómo se identifica el comercio',
    quote: 'puede no coincidir con la marca que el cliente conoce',
  },
  queries: [
    'nombre del comercio en el estado de cuenta distinto a la marca',
    'descriptor del comercio en un cargo con tarjeta',
    'cómo saber qué comercio hizo un cargo',
  ],
};
const SPEI_DISPUTE: CitedPolicy = {
  citation: {
    chunk_id: 'chunk_p01s3',
    doc_id: 'pol-01',
    section: 'Cuándo procede una aclaración por un SPEI enviado',
    quote:
      'el banco abre una disputa con el banco receptor por un SPEI liquidado',
  },
  queries: [
    'SPEI liquidado que el beneficiario no recibió',
    'aclaración por una transferencia enviada que no llegó',
    'disputa con el banco receptor por una transferencia liquidada',
  ],
};
const SPEI_SETTLED: CitedPolicy = {
  citation: {
    chunk_id: 'chunk_p01s3',
    doc_id: 'pol-01',
    section: 'Cuándo procede una aclaración por un SPEI enviado',
    quote:
      'Una transferencia liquidada ya está en el banco del beneficiario y no se puede cancelar',
  },
  queries: [
    'transferencia SPEI liquidada que no aparece en la cuenta destino',
    'beneficiario no ve una transferencia ya liquidada',
    'se puede cancelar un SPEI liquidado',
  ],
};
const CEP: CitedPolicy = {
  citation: {
    chunk_id: 'chunk_p02s3',
    doc_id: 'pol-02',
    section: 'Comprobante electrónico de pago (CEP)',
    quote: 'permite al beneficiario comprobar ante su banco que el pago llegó',
  },
  queries: [
    'comprobante de una transferencia SPEI liquidada',
    'reenviar el CEP de un SPEI enviado',
    'comprobante para que el beneficiario reclame a su banco',
  ],
};
const DECLINED_NO_CHARGE: CitedPolicy = {
  citation: {
    chunk_id: 'chunk_p05s1',
    doc_id: 'pol-05',
    section: 'Motivos de rechazo',
    quote: 'Una compra rechazada no genera ningún cargo',
  },
  queries: [
    'compra rechazada con tarjeta',
    'motivo de rechazo de una compra en línea',
    'por qué se rechaza una compra con tarjeta',
  ],
};

const [CARD_PURCHASE] = CARD_TYPES;
const SPEI_OUT = 'spei_out';
const CARD_AUTHORIZATION = 'get_card_authorization';
const SPEI_STATUS = 'get_spei_status';
const UNRECOGNIZED_CHARGE = 'unrecognized_charge';
const INFORMATIONAL = 'informational';
const CHARGE = 'el cargo';
const TRANSFER = 'la transferencia';
const TO_MARIA = 'a María';

// One customer and transaction per template, from data/scenarios.ts and its
// filler rows, so a batch never shows one movement under two actions.
export const CANARY_TEMPLATES: readonly CanaryTemplate[] = [
  {
    defect: 'wrong_transaction',
    seed: {
      customerId: 'cus_07',
      category: 'unrecognized_card_charge',
      texts: [
        '¿Y este cobro de dónde salió? Veo 899 de un PAYPAL que no me suena de nada.',
        'Me apareció un cargo de PAYPAL por 899 que yo no hice, ¿qué es?',
        'Hola, no reconozco una compra de PAYPAL de 899 en mi tarjeta, ¿me ayudan a aclararla?',
      ],
      draftReply: `Hola {{nombre}}, gracias por escribirnos. Revisamos tu tarjeta y encontramos el cargo de 899 de PAYPAL *DIGITALGOODS del 2026-10-03 a las 22:10, una compra en línea sin tarjeta presente.

Como no reconoces este cargo, con tu reporte basta para abrir la aclaración y no necesitas hacer ningún trámite adicional. Si se abre, tu folio será {{folio}}. {{compromiso_dictamen}}

${NEVER_ASKED}`,
      movement: { noun: CHARGE, amount: '899', at: 'en PAYPAL *DIGITALGOODS' },
      misreadAmount: '989',
      reasoningSummary:
        'Busqué los cargos con tarjeta de la clienta y revisé la autorización del movimiento que reporta: es una compra aprobada y ella dice no reconocerla. Según pol-04, su reporte basta para abrir la aclaración sin trámites adicionales, y pol-03 pide entregar el dictamen por escrito. Propongo abrir una disputa por cargo no reconocido.',
      policies: [CARD_CREDIT, DICTAMEN],
      flags: ['first_party_signal'],
      action: {
        type: 'open_dispute',
        transaction_ids: ['tx_f059'],
        reason_code: UNRECOGNIZED_CHARGE,
        justification:
          'La clienta no reconoce el cargo de PAYPAL *DIGITALGOODS. La autorización muestra una compra aprobada y, según pol-04, con su reporte basta para abrir la aclaración sin pedirle ningún trámite adicional.',
      },
      listFilter: { type: CARD_PURCHASE, limit: 10 },
      lookups: [{ tool: CARD_AUTHORIZATION, transaction_id: 'tx_f059' }],
    },
  },
  {
    defect: 'none_on_disputable',
    seed: {
      customerId: 'cus_15',
      category: 'unrecognized_card_charge',
      texts: [
        'Tengo un cargo de MERCADOPAGO por 1,599 que no reconozco, nunca compré en esa tienda.',
        'Me cobraron 1,599 en MERCADOPAGO y no sé qué es, ¿me lo pueden quitar?',
        'Veo un cargo raro de MERCADOPAGO *TIENDAXYZ de 1,599, ¿de dónde salió?',
      ],
      draftReply: `Hola {{nombre}}, revisamos el cargo de 1599 del 2026-10-03 a las 19:25. Aparece como MERCADOPAGO *TIENDAXYZ, a nombre del comercio Tienda XYZ, y es una compra en línea que quedó liquidada.

El nombre que ves en tu estado de cuenta es el que envía el comercio y puede no coincidir con la marca que conoces. Te sugerimos revisar tus compras en línea de esa fecha; es probable que corresponda a alguna de ellas.

Si después de revisarlo tienes dudas, escríbenos de nuevo. ${NEVER_SHARE}`,
      movement: {
        noun: CHARGE,
        amount: '1599',
        at: 'en MERCADOPAGO *TIENDAXYZ',
      },
      misreadAmount: '1959',
      reasoningSummary:
        'Busqué los cargos de MERCADOPAGO y encontré tx_ad03a por 1599. La autorización muestra una compra en línea aprobada y liquidada, con descriptor MERCADOPAGO *TIENDAXYZ y marca Tienda XYZ. Según pol-04, el descriptor puede no coincidir con la marca que la clienta conoce, así que lo más probable es que sea una compra suya. Solo hace falta explicarle el descriptor.',
      policies: [MERCHANT_DESCRIPTOR],
      flags: ['action_fact_mismatch'],
      action: {
        type: 'none',
        transaction_ids: [],
        reason_code: INFORMATIONAL,
        justification:
          'El cargo tx_ad03a aparece liquidado y su autorización identifica al comercio (Tienda XYZ). Según pol-04, el descriptor puede no coincidir con la marca conocida, por lo que basta con explicárselo a la clienta.',
      },
      listFilter: { type: CARD_PURCHASE, query: 'MERCADOPAGO' },
      lookups: [{ tool: CARD_AUTHORIZATION, transaction_id: 'tx_ad03a' }],
    },
  },
  {
    defect: 'none_on_disputable',
    seed: {
      customerId: 'cus_16',
      category: 'spei_outgoing_not_received',
      texts: [
        'Mandé 9,300 por SPEI el 2 de octubre y la persona todavía no los recibe, ya pasaron días.',
        'Hice una transferencia de 9,300 hace unos días y no le ha llegado al beneficiario, ¿qué pasó?',
        'Mi SPEI de 9,300 del viernes no aparece en la cuenta de destino, ¿me ayudan?',
      ],
      draftReply: `Hola {{nombre}}, revisamos tu transferencia SPEI de 9300 a María del 2026-10-02 a las 13:05. Aparece como liquidada, lo que significa que el dinero ya está en el banco de la beneficiaria y la operación no se puede cancelar.

Te sugerimos pedirle a María que revise sus movimientos con su banco, porque desde nuestro lado la transferencia se completó. Si después de eso sigue sin verla, escríbenos de nuevo.

${NEVER_ASKED}`,
      movement: { noun: TRANSFER, amount: '9300', at: TO_MARIA },
      misreadAmount: '9030',
      reasoningSummary:
        'El SPEI tx_ad04a por 9300 aparece liquidado desde el 2026-10-02. Según pol-01, una transferencia liquidada ya está en el banco del beneficiario y no se puede cancelar. El cliente solo necesita saber que la operación se completó, así que no propongo ninguna acción y le sugiero que la beneficiaria lo revise con su banco.',
      policies: [SPEI_SETTLED],
      flags: [],
      action: {
        type: 'none',
        transaction_ids: [],
        reason_code: INFORMATIONAL,
        justification:
          'La transferencia tx_ad04a está liquidada, así que el dinero ya llegó al banco receptor. Según pol-01 no se puede cancelar; basta con informar al cliente que la operación se completó.',
      },
      listFilter: { type: SPEI_OUT, min_amount: 9300, max_amount: 9300 },
      lookups: [{ tool: SPEI_STATUS, transaction_id: 'tx_ad04a' }],
    },
  },
  {
    defect: 'none_on_disputable',
    seed: {
      customerId: 'cus_12',
      category: 'card_purchase_declined',
      texts: [
        'Ayer me llamaron diciendo que eran del banco y hoy mi tarjeta no pasa, me rechazaron una compra en AliExpress.',
        'Me marcó alguien que dijo ser de albo para validar mi tarjeta y ahora me rechazan las compras, como la de AliExpress.',
        'Recibí un mensaje raro que decía ser del banco y después me rechazaron una compra de 560 en AliExpress.',
      ],
      draftReply: `Hola {{nombre}}, revisamos el intento de compra en ALIEXPRESS por 560 del 2026-10-05 a las 08:05. La compra fue rechazada, así que no se generó ningún cargo a tu cuenta y no hace falta abrir una aclaración.

Si quieres, puedes volver a intentar la compra más tarde. Si alguien vuelve a llamarte a nombre del banco, cuelga y escríbenos por este medio.

${NEVER_SHARE}`,
      movement: { noun: 'la compra', amount: '560', at: 'en ALIEXPRESS' },
      misreadAmount: '650',
      reasoningSummary:
        'El cliente reporta una llamada de alguien que dijo ser del banco y un rechazo en AliExpress. Encontré tx_cd03a por 560, rechazada, y según pol-05 una compra rechazada no genera ningún cargo. Como no hubo un cargo que aclarar, no propongo ninguna acción y solo le recuerdo que no comparta sus datos.',
      policies: [DECLINED_NO_CHARGE],
      flags: ['action_fact_mismatch'],
      action: {
        type: 'none',
        transaction_ids: [],
        reason_code: INFORMATIONAL,
        justification:
          'La compra tx_cd03a fue rechazada y, según pol-05, una compra rechazada no genera ningún cargo. No hay un movimiento que disputar, así que basta con informar al cliente.',
      },
      listFilter: { type: CARD_PURCHASE, query: 'AliExpress' },
      lookups: [{ tool: CARD_AUTHORIZATION, transaction_id: 'tx_cd03a' }],
    },
  },
  {
    defect: 'none_on_disputable',
    seed: {
      customerId: 'cus_09',
      category: 'unrecognized_card_charge',
      texts: [
        'No reconozco este cargo de CAFE LUNA por 145, yo no estuve ahí.',
        'Me cobraron 145 en un SQ *CAFE LUNA COY y no sé qué es.',
        'Hay un cargo de 145 de una cafetería que no conozco, CAFE LUNA, ¿me ayudan?',
      ],
      draftReply: `Hola {{nombre}}, revisamos el cargo de 145 del 2026-10-04 a las 08:30. Aparece como SQ *CAFE LUNA COY, que corresponde a la marca Café Luna, y se hizo con tarjeta presente; la operación quedó liquidada.

El nombre que ves en tu estado de cuenta es el que envía el comercio y puede no coincidir con la marca que conoces. Como la compra se hizo con tu tarjeta física en el comercio, te sugerimos revisar si tú o alguien cercano pagó en esa cafetería.

${NEVER_SHARE}`,
      movement: { noun: CHARGE, amount: '145', at: 'en SQ *CAFE LUNA COY' },
      misreadAmount: '154',
      reasoningSummary:
        'Encontré el cargo tx_cu03a por 145 en SQ *CAFE LUNA COY. La autorización muestra una compra aprobada con tarjeta presente y la marca Café Luna, y el movimiento quedó liquidado. Según pol-04, el descriptor puede no coincidir con la marca que la clienta conoce, así que no propongo ninguna acción y le explico de qué comercio se trata.',
      policies: [MERCHANT_DESCRIPTOR],
      flags: ['action_fact_mismatch'],
      action: {
        type: 'none',
        transaction_ids: [],
        reason_code: INFORMATIONAL,
        justification:
          'El cargo tx_cu03a quedó liquidado y se hizo con tarjeta presente en Café Luna. Según pol-04, el descriptor puede no coincidir con la marca conocida, así que basta con explicarle a la clienta el comercio.',
      },
      listFilter: { type: CARD_PURCHASE, query: 'CAFE LUNA' },
      lookups: [{ tool: CARD_AUTHORIZATION, transaction_id: 'tx_cu03a' }],
    },
  },
  {
    defect: 'wrong_supported_action',
    seed: {
      customerId: 'cus_02',
      category: 'spei_outgoing_not_received',
      texts: [
        'Mandé un SPEI de 12,000 el viernes y la persona dice que no le llegó. ¿Lo pueden cancelar?',
        'Hice una transferencia de 12,000 el viernes y a quien se la mandé no le ha llegado, ¿qué hago?',
        'Envié 12 mil por SPEI el 2 de octubre y el beneficiario sigue sin verlos.',
      ],
      draftReply: `Hola {{nombre}}, revisamos tu transferencia SPEI de 12000 a María del 2026-10-02 a las 11:20. Aparece como liquidada, así que el dinero ya salió hacia el banco de la beneficiaria y no es posible cancelarla.

Como ya pasaron más de 24 horas desde la liquidación y ella no ve el abono, se puede abrir una aclaración para que el banco revise el caso con el banco receptor. Si se abre, tu folio será {{folio}}. {{compromiso_dictamen}}

${NEVER_ASKED}`,
      movement: { noun: TRANSFER, amount: '12000', at: TO_MARIA },
      misreadAmount: '12500',
      reasoningSummary:
        'El SPEI tx_so02a por 12000 aparece liquidado desde el 2026-10-02 y el cliente dice que la beneficiaria no lo ha recibido. Ya pasaron más de 24 horas desde la liquidación, que es el plazo que pol-01 pide para abrir una disputa con el banco receptor. Propongo abrir la aclaración por SPEI no recibido.',
      policies: [SPEI_DISPUTE],
      flags: [],
      action: {
        type: 'open_dispute',
        transaction_ids: ['tx_so02a'],
        reason_code: 'spei_not_received_after_window',
        justification:
          'El SPEI tx_so02a está liquidado y han pasado más de 24 horas sin que la beneficiaria vea el abono. Según pol-01, en ese caso el banco abre una disputa con el banco receptor.',
      },
      listFilter: {
        type: SPEI_OUT,
        from: '2026-10-02T00:00:00-06:00',
        to: '2026-10-02T23:59:59-06:00',
      },
      lookups: [{ tool: SPEI_STATUS, transaction_id: 'tx_so02a' }],
    },
  },
  {
    defect: 'misstated_policy',
    seed: {
      customerId: 'cus_20',
      category: 'spei_outgoing_not_received',
      texts: [
        'Transferí 7,450 por SPEI y el beneficiario no lo ve, necesito el comprobante.',
        '¿Me pueden mandar el comprobante del SPEI de 7,450? A la persona no le aparece.',
        'Necesito el CEP de mi transferencia de 7,450 porque dicen que no la recibieron.',
      ],
      draftReply: `Hola {{nombre}}, revisamos tu transferencia SPEI de 7450 del 2026-10-02 a las 17:30 y aparece como liquidada.

Las transferencias SPEI pueden tardar varios días hábiles en reflejarse en la cuenta de destino, así que es normal que la beneficiaria todavía no la vea. Mientras tanto, proponemos reenviarte el comprobante electrónico de pago (CEP) para que ella lo presente en su banco y compruebe que el pago llegó.

${NEVER_ASKED}`,
      movement: { noun: TRANSFER, amount: '7450', at: TO_MARIA },
      misreadAmount: '7540',
      reasoningSummary:
        'El SPEI tx_ad08a por 7450 está liquidado y tiene CEP disponible. El cliente pide el comprobante porque la beneficiaria no ve el abono. Según pol-02, el CEP permite al beneficiario comprobar ante su banco que el pago llegó, así que propongo reenviarlo para que ella lo presente.',
      policies: [CEP],
      flags: [],
      action: {
        type: 'resend_cep',
        transaction_ids: ['tx_ad08a'],
        reason_code: 'customer_requested_receipt',
        justification:
          'El SPEI tx_ad08a está liquidado y su CEP está disponible. Según pol-02, el comprobante permite a la beneficiaria demostrar ante su banco que el pago llegó.',
      },
      listFilter: { type: SPEI_OUT, min_amount: 7450, max_amount: 7450 },
      lookups: [{ tool: SPEI_STATUS, transaction_id: 'tx_ad08a' }],
    },
  },
  {
    defect: 'wrong_category',
    seed: {
      customerId: 'cus_18',
      category: 'spei_outgoing_not_received',
      texts: [
        'Hola, no reconozco un cargo de STEAM de 320 que me salió el 4 de octubre.',
        'Me llegó un cargo de 320 de STEAM y yo no compré ningún juego, quiero aclararlo.',
        'Alguien usó mi tarjeta en STEAM, me cobraron 320 y no fui yo.',
      ],
      draftReply: `Hola {{nombre}}, revisamos el cargo de 320 en Steam del 2026-10-04 a las 23:40. Fue una compra en línea, sin tarjeta presente, autorizada con un solo factor de autenticación.

Como no reconoces este cargo, con tu reporte basta para abrir la aclaración y no tienes que hacer ningún trámite adicional. Si se abre, tu folio será {{folio}}. {{compromiso_abono}} {{compromiso_dictamen}}

${NEVER_SHARE}`,
      movement: { noun: CHARGE, amount: '320', at: 'en Steam' },
      misreadAmount: '230',
      reasoningSummary:
        'Encontré el cargo tx_ad09a de Steam por 320 y revisé su autorización: compra aprobada sin tarjeta presente y con un solo factor de autenticación. Según pol-04, el reporte del cliente basta para abrir la aclaración y el abono procede porque no hubo dos factores. Propongo abrir una disputa por cargo no reconocido.',
      policies: [CARD_CREDIT, DICTAMEN],
      flags: [],
      action: {
        type: 'open_dispute',
        transaction_ids: ['tx_ad09a'],
        reason_code: UNRECOGNIZED_CHARGE,
        justification:
          'El cliente no reconoce el cargo tx_ad09a de Steam. Se autorizó sin tarjeta presente y con un solo factor de autenticación, y según pol-04 su reporte basta para abrir la aclaración.',
      },
      listFilter: { type: CARD_PURCHASE, query: 'STEAM' },
      lookups: [{ tool: CARD_AUTHORIZATION, transaction_id: 'tx_ad09a' }],
    },
  },
  {
    defect: 'cold_tone',
    seed: {
      customerId: 'cus_06',
      category: 'unrecognized_card_charge',
      texts: [
        'Me apareció un cargo de UBER *TRIP por 399.16 que no reconozco.',
        'No hice ese viaje de UBER por 399.16, quiero que lo revisen.',
        'Desconozco un cargo de UBER de 399 pesos del 13 de septiembre, por favor revísenlo.',
      ],
      draftReply: `Se recibió el reporte por el cargo de 399.16 con descriptor UBER *TRIP del 2026-09-13. La operación se registró sin tarjeta presente y con un solo factor de autenticación.

Procede la apertura de la aclaración conforme a la política vigente. Folio asignado: {{folio}}. {{compromiso_abono}} {{compromiso_dictamen}}

No se requiere documentación adicional. Cualquier otra consulta deberá presentarse por los canales oficiales.`,
      movement: { noun: CHARGE, amount: '399.16', at: 'en UBER *TRIP' },
      misreadAmount: '393.16',
      reasoningSummary:
        'Cargo tx_f056 de UBER *TRIP por 399.16, aprobado sin tarjeta presente y con un solo factor de autenticación. El cliente no lo reconoce. Según pol-04 su reporte basta para abrir la aclaración y procede el abono al no haber dos factores; pol-03 pide el dictamen por escrito. Propongo abrir una disputa.',
      policies: [CARD_CREDIT, DICTAMEN],
      flags: [],
      action: {
        type: 'open_dispute',
        transaction_ids: ['tx_f056'],
        reason_code: UNRECOGNIZED_CHARGE,
        justification:
          'Cargo tx_f056 no reconocido, autorizado sin tarjeta presente y con un solo factor de autenticación. Según pol-04, el reporte del cliente basta para abrir la aclaración sin trámites adicionales.',
      },
      listFilter: { type: CARD_PURCHASE, query: 'UBER' },
      lookups: [{ tool: CARD_AUTHORIZATION, transaction_id: 'tx_f056' }],
    },
  },
];

/**
 * The template a canary's case replays: the one of its defect and customer
 * whose phrasings hold its stored text, so a defect may have several
 * templates without a column naming them. Throws when none or more than one
 * matches, since replaying the wrong script would land the wrong defect.
 */
export function canaryTemplateOf(canary: CanaryCase): CanaryTemplate {
  const matches = CANARY_TEMPLATES.filter(
    ({ defect, seed }) =>
      defect === canary.defect &&
      seed.customerId === canary.customerId &&
      seed.texts.some((text) => maskPii(text) === canary.textMasked),
  );
  const [template] = matches;
  // The worker logs this error on every attempt, and canary_cases never reaches a log (02 G3).
  if (!template || matches.length > 1) {
    throw new Error('no replay script for this case');
  }
  return template;
}
