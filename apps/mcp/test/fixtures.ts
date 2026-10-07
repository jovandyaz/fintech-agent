import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import {
  CASE_TOKEN_ISSUER,
  CASE_TOKEN_SCOPE,
  type CardTx,
  type Customer,
} from '@fintech-agent/contracts';
import { SignJWT } from 'jose';

export const CASE_TOKEN_KEY = 'test-case-token-key-with-at-least-32-bytes';
export const READ_KEY = 'test-core-read-key';
export const AUDIENCE = 'http://mcp.internal/mcp';
export const OWNER = 'cus_01';
export const OTHER = 'cus_02';
export const CASE_ID = 'case_ab12';
export const RUN_ID = 'run_cd34';
export const TOKEN_TTL_S = 300;

/** A core-mock customer with full values, as only core-mock holds them. */
export const customer = (id: string): Customer => ({
  id,
  first_name: 'Ana',
  last_names: 'Gómez Pérez',
  rfc: 'GOPA741222HKG',
  curp: 'GOPA741222MDFGHJP1',
  email: 'ana.gomez@example.com',
  phone: '5532732905',
  clabe: '646180590988801788',
  card_pan: '4761343220832617',
  card_status: 'active',
  kyc_level: 'N3',
  account_status: 'active',
});

export const cardCharge: CardTx = {
  id: 'tx_cu01a',
  customer_id: OWNER,
  type: 'card_purchase',
  status: 'settled',
  amount: 899,
  created_at: '2026-10-03T22:10:00-06:00',
  merchant_descriptor: 'PAYPAL *DIGITALGOODS',
  merchant_brand: 'Digital Goods Ltd',
  channel: 'card_not_present',
  auth_factors: 1,
  decline_reason: null,
};

export const foreignCharge: CardTx = {
  ...cardCharge,
  id: 'tx_f001',
  customer_id: OTHER,
};

/** Listens on loopback only, the address the tests dial. */
export async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

export const close = (server: Server): Promise<void> =>
  new Promise((resolve) => server.close(() => resolve()));

const MS_PER_SECOND = 1000;

export const now = (): number => Math.floor(Date.now() / MS_PER_SECOND);

export interface MintOptions {
  key?: string;
  issuer?: string;
  audience?: string;
  scope?: string;
  issuedAt?: number;
  expiresAt?: number;
  jti?: string;
  caseId?: string;
  runId?: string;
}

let nextJti = 0;

/** A case token for `OWNER`; every option bends one claim the server must check. */
export async function mint(options: MintOptions = {}): Promise<string> {
  const issuedAt = options.issuedAt ?? now();
  return new SignJWT({
    case_id: options.caseId ?? CASE_ID,
    run_id: options.runId ?? RUN_ID,
    scope: options.scope ?? CASE_TOKEN_SCOPE,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(options.issuer ?? CASE_TOKEN_ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setSubject(OWNER)
    .setJti(options.jti ?? `jti_${nextJti++}`)
    .setIssuedAt(issuedAt)
    .setExpirationTime(options.expiresAt ?? issuedAt + TOKEN_TTL_S)
    .sign(new TextEncoder().encode(options.key ?? CASE_TOKEN_KEY));
}
