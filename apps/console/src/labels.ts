import type {
  ActionStatus,
  ActionType,
  CaseCategory,
  CaseFlag,
  CaseStatus,
  ReasonCode,
  RejectCode,
  ReplyCheckCode,
  RunStatus,
  StepKind,
  StopReason,
} from '@fintech-agent/contracts/console';

/** What an operator reads for each case status. */
export const STATUS_LABEL: Record<CaseStatus, string> = {
  queued: 'En cola',
  investigating: 'Investigando',
  needs_review: 'Por revisar',
  resolved: 'Resuelto',
  failed: 'Fallido',
};

/** Each flag as a reason to look twice (02 G3: flags need acknowledgment). */
export const FLAG_LABEL: Record<CaseFlag, string> = {
  injection_signal: 'Posible instrucción en el texto del cliente',
  policy_data_conflict: 'La política y los datos no coinciden',
  action_fact_mismatch: 'La acción no se apoya en los datos',
  first_party_signal: 'Posible fraude de primera parte',
  abstained: 'El agente se abstuvo',
  fallback: 'Propuesta de respaldo, sin investigación completa',
};

/** The case category in the operator's words. */
export const CATEGORY_LABEL: Record<CaseCategory, string> = {
  spei_outgoing_not_received: 'SPEI enviado que no llegó',
  spei_incoming_not_credited: 'SPEI recibido sin abonar',
  unrecognized_card_charge: 'Cargo con tarjeta no reconocido',
  card_purchase_declined: 'Compra con tarjeta rechazada',
  general_inquiry: 'Consulta general',
  out_of_scope_or_suspicious: 'Fuera de alcance o sospechoso',
};

/** What an action does, named the way the Approve button names its effect. */
export const ACTION_LABEL: Record<ActionType, string> = {
  open_dispute: 'Abrir aclaración',
  resend_cep: 'Reenviar comprobante (CEP)',
  escalate_fraud: 'Escalar a fraude',
  none: 'Responder sin acción',
};

/** Where a proposal stands; the canary outcomes only ever show after the decision (02 G3). */
export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  proposed: 'Por decidir',
  approved: 'Aprobada, en espera de ejecución',
  executed: 'Ejecutada',
  rejected: 'Rechazada',
  failed: 'La ejecución falló',
  superseded: 'Reemplazada por una nueva investigación',
  canary_caught: 'Canario detectado',
  canary_missed: 'Canario no detectado',
};

/** Why the action is proposed, in the operator's words. */
export const REASON_LABEL: Record<ReasonCode, string> = {
  unrecognized_charge: 'Cargo no reconocido',
  spei_not_received_after_window: 'SPEI no recibido después del plazo',
  beneficiary_missing_funds: 'El beneficiario no recibió los fondos',
  customer_requested_receipt: 'El cliente pidió su comprobante',
  suspected_card_fraud: 'Sospecha de fraude con tarjeta',
  suspected_social_engineering: 'Sospecha de ingeniería social',
  third_party_data_request: 'Pide datos de un tercero',
  informational: 'Consulta informativa',
  no_policy_support: 'Ninguna política la respalda',
  insufficient_information: 'Falta información',
};

/** What was wrong with a rejected proposal. */
export const REJECT_LABEL: Record<RejectCode, string> = {
  wrong_category: 'Categoría equivocada',
  wrong_action: 'Acción equivocada',
  wrong_transactions: 'Transacciones equivocadas',
  wrong_policy_or_ungrounded: 'Política equivocada o sin sustento',
  missing_policy: 'Falta una política',
  tone: 'Tono inadecuado',
  other: 'Otro motivo',
};

/** What a reply check found, completing "La respuesta no pasa estas revisiones: …". */
export const REPLY_CHECK_LABEL: Record<ReplyCheckCode, string> = {
  PII_IN_REPLY: 'tiene datos personales',
  LINK_IN_REPLY: 'tiene un enlace',
  AUTH_FACTOR_REQUEST:
    'pide un factor de autenticación fuera de los avisos aprobados',
};

/** How an agent run ended. */
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: 'En curso',
  succeeded: 'Completa',
  fallback: 'De respaldo',
  failed: 'Fallida',
  abandoned: 'Abandonada',
};

/** Why an agent run stopped. */
export const STOP_REASON_LABEL: Record<StopReason, string> = {
  completed: 'terminó',
  budget: 'agotó el presupuesto',
  validation: 'no pasó la validación',
  agent_disabled: 'agente apagado',
  error: 'error',
};

/** What a trace step did. */
export const STEP_KIND_LABEL: Record<StepKind, string> = {
  llm: 'Modelo',
  tool: 'Herramienta',
  retrieval: 'Búsqueda de políticas',
  guard: 'Control',
  validation: 'Validación',
};
