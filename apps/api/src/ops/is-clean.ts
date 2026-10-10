import {
  CREDENTIAL_REDACTED,
  hasPii,
  MASK_MARKERS,
  maskJson,
} from '@fintech-agent/contracts';

const ALREADY_MASKED = new Set<unknown>([...MASK_MARKERS, CREDENTIAL_REDACTED]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function leafIsClean(original: string | number, masked: unknown): boolean {
  if (masked === original) return true;
  // An auth factor carries no digit run hasPii would see, so its slot may hold only a marker.
  if (typeof masked === 'string' && MASK_MARKERS.includes(masked)) {
    return ALREADY_MASKED.has(original);
  }
  // hasPii, not `maskPii(x) === x`: folding alone (an ellipsis, a no-break space) is not PII.
  return !hasPii(String(original));
}

// Beside maskJson's output, so a UUID under an id key or an epoch under a time key stays clean.
function walkIsClean(original: unknown, masked: unknown): boolean {
  if (typeof original === 'string' || typeof original === 'number') {
    return leafIsClean(original, masked);
  }
  if (Array.isArray(original)) {
    return (
      Array.isArray(masked) &&
      masked.length === original.length &&
      original.every((item, i) => walkIsClean(item, masked[i]))
    );
  }
  if (isRecord(original)) {
    if (!isRecord(masked)) return false;
    const entries = Object.entries(original);
    const maskedValues = Object.values(masked);
    return (
      maskedValues.length === entries.length &&
      entries.every(
        ([key, value], i) =>
          !hasPii(key) && walkIsClean(value, maskedValues[i]),
      )
    );
  }
  return masked === original;
}

/**
 * Whether a logged or stored value holds nothing the masker would mask (02
 * G6): every text, key and number passes `hasPii`, unless `maskJson` keeps it
 * verbatim; a slot `maskJson` replaces whole (an auth factor) holds a marker
 * already. A value the masker cannot read is not clean.
 */
export function isClean(value: unknown): boolean {
  try {
    return walkIsClean(value, maskJson(value));
  } catch {
    return false;
  }
}
