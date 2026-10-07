import type { AddressInfo } from 'node:net';

import {
  startTestDatabase,
  type TestDatabase,
} from '@fintech-agent/api/test-database';
import {
  CASE_TOKEN_ISSUER,
  CASE_TOKEN_SCOPE,
  type CardTx,
  type Customer,
} from '@fintech-agent/contracts';
import { createCoreMock, type CoreMock } from '@fintech-agent/core-mock';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { SignJWT } from 'jose';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMcpApp, type McpApp } from './app.js';
import { createPostgresSecurityEventSink } from './security-events.js';

const CONTAINER_START_MS = 120_000;
const CASE_TOKEN_KEY = 'test-case-token-key-with-at-least-32-bytes';
const READ_KEY = 'test-core-read-key';
const AUDIENCE = 'http://mcp.internal/mcp';
const OWNER = 'cus_01';
const OTHER = 'cus_02';
const CASE_ID = 'case_pg01';
const RUN_ID = 'run_pg01';
const TOKEN_TTL_S = 300;

const customer = (id: string): Customer => ({
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

const foreignCharge: CardTx = {
  id: 'tx_f001',
  customer_id: OTHER,
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

let db: TestDatabase;
let owner: postgres.Sql;
let mcpRole: postgres.Sql;
let core: CoreMock;
let app: McpApp;
let mcpUrl: string;

const listen = async (server: CoreMock['server']): Promise<string> => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
};

const close = (server: CoreMock['server']): Promise<void> =>
  new Promise((resolve) => server.close(() => resolve()));

beforeAll(async () => {
  db = await startTestDatabase();
  owner = postgres(db.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`
    insert into cases (id, ticket_id, folio, received_at, source, customer_id, text_masked)
    values (${CASE_ID}, 'T-pg01', 'AC-KMQX-PG01', now(), 'webhook', ${OWNER}, 'hola')`;
  await owner`
    insert into agent_runs (id, case_id, variant, model, prompt_version)
    values (${RUN_ID}, ${CASE_ID}, 'a', 'model', 'v1')`;
  core = createCoreMock({
    customers: [customer(OWNER), customer(OTHER)],
    transactions: [foreignCharge],
    readKey: READ_KEY,
    executorKey: 'test-executor-key',
    databasePath: ':memory:',
    log: () => undefined,
  });
  mcpRole = postgres(db.urlFor('copilot_mcp'), {
    max: 1,
    onnotice: () => undefined,
  });
  app = createMcpApp({
    coreUrl: await listen(core.server),
    coreReadKey: READ_KEY,
    caseTokenKey: CASE_TOKEN_KEY,
    audience: AUDIENCE,
    securityEvents: createPostgresSecurityEventSink(mcpRole),
    log: () => undefined,
  });
  mcpUrl = `${await listen(app.server)}/mcp`;
}, CONTAINER_START_MS);

afterAll(async () => {
  await close(app.server);
  await close(core.server);
  core.close();
  await mcpRole.end();
  await owner.end();
  await db.stop();
});

describe('security events in Postgres (02 G4)', () => {
  it('records a foreign lookup as one row, inserted as copilot_mcp', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      case_id: CASE_ID,
      run_id: RUN_ID,
      scope: CASE_TOKEN_SCOPE,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(CASE_TOKEN_ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(OWNER)
      .setJti('jti_pg01')
      .setIssuedAt(now)
      .setExpirationTime(now + TOKEN_TTL_S)
      .sign(new TextEncoder().encode(CASE_TOKEN_KEY));
    const client = new Client({ name: 'pg-spec', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(mcpUrl), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );

    const result = await client.callTool({
      name: 'get_card_authorization',
      arguments: { transaction_id: foreignCharge.id },
    });
    await client.close();

    expect(result.isError).toBe(true);
    const rows = await owner`
      select kind, case_id, run_id, ref_masked from security_events`;
    expect(rows).toEqual([
      {
        kind: 'cross_customer_lookup',
        case_id: CASE_ID,
        run_id: RUN_ID,
        ref_masked: foreignCharge.id,
      },
    ]);
  });
});
