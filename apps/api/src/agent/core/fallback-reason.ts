const BUDGET = 'budget';

const listed = (codes: readonly string[]): string => codes.join(', ');

/**
 * Why a proposal is `none` without the agent choosing it, as the operator
 * reads it beside the proposal (01: a visible reason). Validator codes and
 * rule ids stay in parentheses, so the trace and the evals can still match
 * them.
 */
export const FALLBACK_REASON = {
  agentDisabled: 'El agente está apagado: el caso no se investigó.',
  fillFailed: 'No se pudo completar la respuesta con los datos del cliente.',
  filledReplyFailed: (codes: readonly string[]): string =>
    `La respuesta, ya con los datos del cliente, no pasó las revisiones (${listed(codes)}).`,
  repairFailed: (codes: readonly string[]): string =>
    `La propuesta no pasó la validación después de un intento de corrección (${listed(codes)}).`,
  stopped: (reason: string): string =>
    reason === BUDGET
      ? 'La investigación agotó su presupuesto antes de terminar.'
      : `La investigación se detuvo antes de terminar (${reason}).`,
  policyConflict: (ruleIds: readonly string[]): string =>
    `La política y los datos del caso no coinciden (${listed(ruleIds)}); no se propone ninguna acción.`,
} as const;
