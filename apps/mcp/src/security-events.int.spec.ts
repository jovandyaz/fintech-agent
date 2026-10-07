import {
  insertCase,
  startTestDatabase,
  type TestDatabase,
} from '@fintech-agent/api/test-database';
import { createCoreMock, type CoreMock } from '@fintech-agent/core-mock';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AUDIENCE,
  CASE_ID,
  CASE_TOKEN_KEY,
  OTHER,
  OWNER,
  READ_KEY,
  RUN_ID,
  close,
  customer,
  foreignCharge,
  listen,
  mint,
} from '../test/fixtures.js';
import { createMcpApp, type McpApp } from './app.js';
import { createPostgresSecurityEventSink } from './security-events.js';

const CONTAINER_START_MS = 120_000;

let db: TestDatabase;
let owner: postgres.Sql;
let mcpRole: postgres.Sql;
let core: CoreMock;
let app: McpApp;
let mcpUrl: string;

beforeAll(async () => {
  db = await startTestDatabase();
  owner = postgres(db.ownerUrl, { max: 1, onnotice: () => undefined });
  await insertCase(owner, CASE_ID, OWNER);
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
    const client = new Client({ name: 'pg-spec', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(mcpUrl), {
        requestInit: { headers: { authorization: `Bearer ${await mint()}` } },
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
