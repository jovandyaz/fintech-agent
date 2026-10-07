import { randomUUID } from 'node:crypto';

import { CASE_TOKEN_ISSUER, CASE_TOKEN_SCOPE } from '@fintech-agent/contracts';
import { SignJWT } from 'jose';

import { CASE_TOKEN_MARGIN_MS } from '../../config.js';

const ALGORITHM = 'HS256';
const MS_PER_SECOND = 1000;

/** What a case token binds: one attempt of one case of one customer. */
export interface CaseTokenInput {
  key: string;
  audience: string;
  customerId: string;
  caseId: string;
  runId: string;
  now: Date;
  runTimeoutMs: number;
}

/**
 * Mints the token the MCP server resolves the customer from (02 G4). It
 * outlives the attempt by `CASE_TOKEN_MARGIN_MS`, and its fresh `jti` gives
 * the run its own call budget. Mint it only after the run row is committed.
 */
export async function mintCaseToken(input: CaseTokenInput): Promise<string> {
  const issuedAt = Math.floor(input.now.getTime() / MS_PER_SECOND);
  const lifetimeS = Math.ceil(
    (input.runTimeoutMs + CASE_TOKEN_MARGIN_MS) / MS_PER_SECOND,
  );
  return new SignJWT({
    case_id: input.caseId,
    run_id: input.runId,
    scope: CASE_TOKEN_SCOPE,
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(CASE_TOKEN_ISSUER)
    .setAudience(input.audience)
    .setSubject(input.customerId)
    .setJti(randomUUID())
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + lifetimeS)
    .sign(new TextEncoder().encode(input.key));
}
