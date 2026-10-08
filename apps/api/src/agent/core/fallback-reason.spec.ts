import { describe, expect, it } from 'vitest';

import { FALLBACK_REASON } from './fallback-reason.js';

describe('fallback reasons, as the operator reads them (01: a visible reason)', () => {
  it('says the agent was off', () => {
    expect(FALLBACK_REASON.agentDisabled).toBe(
      'El agente está apagado: el caso no se investigó.',
    );
  });

  it('names the checks a repaired proposal still failed, codes kept for the trace', () => {
    expect(
      FALLBACK_REASON.repairFailed(['UNGROUNDED_NUMBER', 'NO_SUPPORT']),
    ).toBe(
      'La propuesta no pasó la validación después de un intento de corrección (UNGROUNDED_NUMBER, NO_SUPPORT).',
    );
  });

  it('names the checks the filled reply failed', () => {
    expect(FALLBACK_REASON.filledReplyFailed(['PII_IN_REPLY'])).toBe(
      'La respuesta, ya con los datos del cliente, no pasó las revisiones (PII_IN_REPLY).',
    );
  });

  it('says the reply could not be filled', () => {
    expect(FALLBACK_REASON.fillFailed).toBe(
      'No se pudo completar la respuesta con los datos del cliente.',
    );
  });

  it('says a run ran out of budget, or names why else it stopped', () => {
    expect(FALLBACK_REASON.stopped('budget')).toBe(
      'La investigación agotó su presupuesto antes de terminar.',
    );
    expect(FALLBACK_REASON.stopped('tool_failed:get_spei_status')).toBe(
      'La investigación se detuvo antes de terminar (tool_failed:get_spei_status).',
    );
  });

  it('names the policy rules the data contradicts', () => {
    expect(FALLBACK_REASON.policyConflict(['spei-returned'])).toBe(
      'La política y los datos del caso no coinciden (spei-returned); no se propone ninguna acción.',
    );
  });
});
