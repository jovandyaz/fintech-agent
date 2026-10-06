import {
  CASE_TOKEN_ISSUER,
  CASE_TOKEN_MAX_TTL_S,
  CaseTokenClaimsSchema,
  type CaseTokenClaims,
} from '@fintech-agent/contracts';
import { jwtVerify } from 'jose';

const ALGORITHMS = ['HS256'];
const REQUIRED_CLAIMS = ['sub', 'jti', 'iat', 'exp'];

/**
 * Verifies a case token per RFC 8725: HS256 only, issuer and audience pinned,
 * at most ten minutes of life. Returns null for any token that fails; the
 * caller answers 401 without saying why.
 */
export async function verifyCaseToken(
  token: string,
  key: Uint8Array,
  audience: string,
): Promise<CaseTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ALGORITHMS,
      issuer: CASE_TOKEN_ISSUER,
      audience,
      requiredClaims: REQUIRED_CLAIMS,
      maxTokenAge: CASE_TOKEN_MAX_TTL_S,
    });
    const claims = CaseTokenClaimsSchema.safeParse(payload);
    if (!claims.success) return null;
    const { iat, exp } = claims.data;
    return exp - iat <= CASE_TOKEN_MAX_TTL_S ? claims.data : null;
  } catch {
    return null;
  }
}
