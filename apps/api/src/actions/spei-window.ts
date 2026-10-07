import {
  MS_PER_HOUR,
  SPEI_DISPUTE_AFTER_HOURS,
} from '@fintech-agent/contracts';

const SPEI_WINDOW_MS = SPEI_DISPUTE_AFTER_HOURS * MS_PER_HOUR;

/**
 * Whether a SPEI settled long enough ago to be disputed (02 G2, the "Tiempos
 * SPEI" window). An unsettled or unparseable time is never past it.
 */
export const pastSpeiWindow = (settledAt: string | null, now: Date): boolean =>
  // Negated so a settlement time that does not parse (NaN) fails closed.
  settledAt !== null && now.getTime() - Date.parse(settledAt) >= SPEI_WINDOW_MS;
