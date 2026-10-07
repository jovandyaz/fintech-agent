import { createHash, timingSafeEqual } from 'node:crypto';

const ENTRY_SEPARATOR = ',';
const FIELD_SEPARATOR = ':';
const ENTRY_FIELDS = 3;
const MIN_TOKEN_CHARS = 24;
const NAME_PATTERN = /^[a-z0-9_-]+$/;

/** One operator key, held only as the SHA-256 of its token. */
export interface OperatorCredential {
  operatorId: string;
  keyId: string;
  digest: Buffer;
}

/** Who decided: resolved from the bearer token, never from a request body (02 G3). */
export interface Operator {
  id: string;
  keyId: string;
  actor: `operator:${string}`;
}

const digestOf = (token: string): Buffer =>
  createHash('sha256').update(token, 'utf8').digest();

function refuse(index: number, problem: string): never {
  throw new Error(`OPERATOR_TOKENS entry ${index + 1} ${problem}`);
}

/**
 * Parses `id:keyId:token` entries separated by commas. The key id lets a
 * token rotate without changing who the operator is. Errors name the entry,
 * never its token.
 */
export function parseOperatorTokens(raw: string): OperatorCredential[] {
  const seenTokens = new Set<string>();
  const seenKeys = new Set<string>();
  return raw.split(ENTRY_SEPARATOR).map((entry, index) => {
    const fields = entry.trim().split(FIELD_SEPARATOR);
    if (fields.length !== ENTRY_FIELDS) refuse(index, 'is not id:keyId:token');
    const [operatorId = '', keyId = '', token = ''] = fields;
    if (!NAME_PATTERN.test(operatorId) || !NAME_PATTERN.test(keyId)) {
      refuse(index, 'has an id or key id outside [a-z0-9_-]');
    }
    if (token.length < MIN_TOKEN_CHARS) {
      refuse(index, `has a token shorter than ${MIN_TOKEN_CHARS} characters`);
    }
    const digest = digestOf(token);
    const key = `${operatorId}${FIELD_SEPARATOR}${keyId}`;
    if (seenTokens.has(digest.toString('hex')))
      refuse(index, 'repeats a token');
    if (seenKeys.has(key)) refuse(index, 'repeats an operator key');
    seenTokens.add(digest.toString('hex'));
    seenKeys.add(key);
    return { operatorId, keyId, digest };
  });
}

/**
 * The operator a presented token belongs to, or null. Compares SHA-256
 * digests in constant time against every credential, so neither a prefix nor
 * the position of the match shows in the timing.
 */
export function resolveOperator(
  credentials: readonly OperatorCredential[],
  presented: string,
): Operator | null {
  const digest = digestOf(presented);
  let match: OperatorCredential | undefined;
  for (const credential of credentials) {
    if (timingSafeEqual(credential.digest, digest) && !match) {
      match = credential;
    }
  }
  return match
    ? {
        id: match.operatorId,
        keyId: match.keyId,
        actor: `operator:${match.operatorId}`,
      }
    : null;
}
