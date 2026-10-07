import {
  CASE_TOKEN_ISSUER,
  CASE_TOKEN_MAX_TTL_S,
  CASE_TOKEN_SCOPE,
  CaseTokenClaimsSchema,
} from '@fintech-agent/contracts';
import { decodeProtectedHeader, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import { CASE_TOKEN_MARGIN_MS } from '../../config.js';
import { mintCaseToken, type CaseTokenInput } from './case-token.js';

const KEY = 'k'.repeat(32);
const AUDIENCE = 'http://mcp.test/mcp';
const NOW = new Date('2026-10-07T15:00:00.400Z');
const NOW_S = Math.floor(NOW.getTime() / 1000);
const INPUT: CaseTokenInput = {
  key: KEY,
  audience: AUDIENCE,
  customerId: 'cus_ana',
  caseId: 'case_1',
  runId: 'run_1',
  now: NOW,
  runTimeoutMs: 180_000,
};

const verified = async (token: string) => {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(KEY), {
    algorithms: ['HS256'],
    issuer: CASE_TOKEN_ISSUER,
    audience: AUDIENCE,
    requiredClaims: ['sub', 'jti', 'iat', 'exp'],
    maxTokenAge: CASE_TOKEN_MAX_TTL_S,
    currentDate: NOW,
  });
  return CaseTokenClaimsSchema.parse(payload);
};

describe('mintCaseToken (02 G4)', () => {
  it('signs HS256 claims binding the customer, case and run to read scope', async () => {
    const token = await mintCaseToken(INPUT);
    expect(decodeProtectedHeader(token)).toEqual({ alg: 'HS256' });
    expect(await verified(token)).toMatchObject({
      iss: CASE_TOKEN_ISSUER,
      aud: AUDIENCE,
      sub: 'cus_ana',
      case_id: 'case_1',
      run_id: 'run_1',
      scope: CASE_TOKEN_SCOPE,
      iat: NOW_S,
    });
  });

  it('outlives the attempt by the token margin', async () => {
    const claims = await verified(await mintCaseToken(INPUT));
    expect(claims.exp - claims.iat).toBe(
      (INPUT.runTimeoutMs + CASE_TOKEN_MARGIN_MS) / 1000,
    );
  });

  it('rounds a partial second of lifetime up, never down', async () => {
    const claims = await verified(
      await mintCaseToken({ ...INPUT, runTimeoutMs: 180_001 }),
    );
    expect(claims.exp - claims.iat).toBe(241);
  });

  it('stays within the lifetime the MCP server accepts at the longest timeout', async () => {
    const longest = CASE_TOKEN_MAX_TTL_S * 1000 - CASE_TOKEN_MARGIN_MS;
    const claims = await verified(
      await mintCaseToken({ ...INPUT, runTimeoutMs: longest }),
    );
    expect(claims.exp - claims.iat).toBe(CASE_TOKEN_MAX_TTL_S);
  });

  it('gives every token its own jti, so each run has its own call budget', async () => {
    const [first, second] = await Promise.all([
      mintCaseToken(INPUT).then(verified),
      mintCaseToken(INPUT).then(verified),
    ]);
    expect(first.jti).not.toBe(second.jti);
  });
});
