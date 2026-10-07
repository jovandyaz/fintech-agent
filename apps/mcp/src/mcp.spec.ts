import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  CASE_TOKEN_ISSUER,
  CASE_TOKEN_MAX_CALLS,
  CASE_TOKEN_SCOPE,
  CardAuthorizationSchema,
  CustomerViewSchema,
  MCP_TOOL_NAMES,
  SpeiStatusSchema,
  TransactionPageSchema,
  type CardTx,
  type Customer,
  type SpeiTx,
  type Transaction,
} from '@fintech-agent/contracts';
import { createCoreMock, type CoreMock } from '@fintech-agent/core-mock';

import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { SignJWT, UnsecuredJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { READ_ONLY } from './annotations.js';
import { createMcpApp, type McpApp, type McpAppOptions } from './app.js';
import type { SecurityEvent } from './security-events.js';
import { createCallBudget, registerTools } from './tools.js';

const CASE_TOKEN_KEY = 'test-case-token-key-with-at-least-32-bytes';
const WEBHOOK_SECRET = 'test-webhook-secret-with-at-least-32-bytes';
const READ_KEY = 'test-core-read-key';
const AUDIENCE = 'http://mcp.internal/mcp';
const OWNER = 'cus_01';
const OTHER = 'cus_02';
const CASE_ID = 'case_ab12';
const RUN_ID = 'run_cd34';
const TOKEN_TTL_S = 300;
const TOO_LONG_TTL_S = 601;
const PAST_S = 3600;
const EXPIRED_AGO_S = 30;
const MODERN = '2026-07-28';
const LEGACY = '2025-11-25';
type ProtocolEra = typeof MODERN | typeof LEGACY;
const PLANTED_PAN = '4111111111111111';
const PLANTED_PHONE = '5512345678';
const TOOL_ORDER = [
  'get_customer',
  'list_transactions',
  'get_spei_status',
  'get_card_authorization',
];

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

const speiOut: SpeiTx = {
  id: 'tx_so02a',
  customer_id: OWNER,
  type: 'spei_out',
  status: 'returned',
  amount: 12000,
  created_at: '2026-10-02T11:20:00-06:00',
  counterparty_name: 'María Fernanda López Ruiz',
  counterparty_clabe: '072180009876543213',
  tracking_key: 'BNET20261002SO2A',
  numeric_reference: '1005261',
  settled_at: '2026-10-02T11:20:04-06:00',
  hold_reason: null,
  return_reason: 'cuenta_inexistente',
  returned_at: '2026-10-02T15:00:00-06:00',
  reversal_credit_id: null,
  reverses_tx_id: null,
  reject_reason: null,
  cep_available: true,
};

const cardCharge: CardTx = {
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

const foreignCharge: CardTx = {
  ...cardCharge,
  id: 'tx_f001',
  customer_id: OTHER,
};

const foreignSpei: SpeiTx = { ...speiOut, id: 'tx_f002', customer_id: OTHER };

interface Upstream {
  url: string;
  headers: Headers;
}

let core: CoreMock;
let coreUrl: string;
let app: McpApp;
let mcpUrl: string;
let events: SecurityEvent[];
let logs: Record<string, unknown>[];
let sinkFailure: Error | undefined;
let upstream: Upstream[];
let stubbed: (() => Promise<Response>) | undefined;
let nextJti = 0;

const listen = async (server: CoreMock['server']): Promise<string> => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
};

const close = (server: CoreMock['server']): Promise<void> =>
  new Promise((resolve) => server.close(() => resolve()));

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

interface MintOptions {
  key?: string;
  issuer?: string;
  audience?: string;
  scope?: string;
  issuedAt?: number;
  expiresAt?: number;
  jti?: string;
}

const now = (): number => Math.floor(Date.now() / 1000);

async function mint(options: MintOptions = {}): Promise<string> {
  const issuedAt = options.issuedAt ?? now();
  return new SignJWT({
    case_id: CASE_ID,
    run_id: RUN_ID,
    scope: options.scope ?? CASE_TOKEN_SCOPE,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(options.issuer ?? CASE_TOKEN_ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setSubject(OWNER)
    .setJti(options.jti ?? `jti_${nextJti++}`)
    .setIssuedAt(issuedAt)
    .setExpirationTime(options.expiresAt ?? issuedAt + TOKEN_TTL_S)
    .sign(encode(options.key ?? CASE_TOKEN_KEY));
}

async function connect(
  token: string,
  era: ProtocolEra = MODERN,
): Promise<Client> {
  const client = new Client(
    { name: 'mcp-spec', version: '0.0.0' },
    {
      versionNegotiation: { mode: era === MODERN ? { pin: MODERN } : 'legacy' },
    },
  );
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

interface ToolOutcome {
  isError: boolean;
  body: Record<string, unknown>;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolOutcome> {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as { type: string; text: string }[];
  return {
    isError: result.isError === true,
    body: JSON.parse(first?.text ?? '{}') as Record<string, unknown>,
  };
}

const rawPost = (token?: string): Promise<Response> =>
  fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

async function startCore(
  customers: Customer[],
  transactions: Transaction[],
): Promise<void> {
  core = createCoreMock({
    customers,
    transactions,
    readKey: READ_KEY,
    executorKey: 'test-executor-key',
    databasePath: ':memory:',
    log: () => undefined,
  });
  coreUrl = await listen(core.server);
}

async function startApp(overrides: Partial<McpAppOptions> = {}): Promise<void> {
  app = createMcpApp({
    coreUrl,
    coreReadKey: READ_KEY,
    caseTokenKey: CASE_TOKEN_KEY,
    audience: AUDIENCE,
    securityEvents: {
      record: (event) => {
        events.push(event);
        return sinkFailure === undefined
          ? Promise.resolve()
          : Promise.reject(sinkFailure);
      },
    },
    fetch: (input, init) => {
      upstream.push({
        url: String(input),
        headers: new Headers(init?.headers),
      });
      return stubbed?.() ?? fetch(input, init);
    },
    log: (line) => logs.push(line),
    ...overrides,
  });
  mcpUrl = `${await listen(app.server)}/mcp`;
}

async function stopAll(): Promise<void> {
  await close(app.server);
  await close(core.server);
  core.close();
}

beforeEach(async () => {
  events = [];
  logs = [];
  sinkFailure = undefined;
  upstream = [];
  stubbed = undefined;
  await startCore(
    [customer(OWNER), customer(OTHER)],
    [speiOut, cardCharge, foreignCharge, foreignSpei],
  );
  await startApp();
});

afterEach(stopAll);

interface RawAnswer {
  status: number;
  body: string;
}

function rawRequest(
  headers: Record<string, string>,
  path = '/mcp',
): Promise<RawAnswer> {
  const { port } = new URL(mcpUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method: 'POST', headers },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  });
}

describe('MCP DNS-rebinding protection', () => {
  const FORBIDDEN = 403;
  const json = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };

  it('refuses a Host that is neither the audience host nor loopback, before any token check', async () => {
    const answer = await rawRequest({
      ...json,
      host: 'evil.example:3020',
      authorization: `Bearer ${await mint()}`,
    });
    expect(answer.status).toBe(FORBIDDEN);
  });

  it('refuses a browser Origin from another site', async () => {
    const answer = await rawRequest({
      ...json,
      origin: 'http://evil.example',
      authorization: `Bearer ${await mint()}`,
    });
    expect(answer.status).toBe(FORBIDDEN);
  });

  it('accepts a configured dial host when the audience is a different canonical URL', async () => {
    await close(app.server);
    await startApp({
      audience: 'https://mcp.case-copilot.example/mcp',
      allowedHosts: ['mcp'],
    });
    const dialed = await rawRequest({ ...json, host: 'mcp:3020' });
    const other = await rawRequest({ ...json, host: 'api:3000' });
    expect([dialed.status, other.status]).toEqual([401, FORBIDDEN]);
  });

  it('lets the audience host and loopback through to authentication', async () => {
    for (const host of [new URL(AUDIENCE).host, 'localhost:3020']) {
      const answer = await rawRequest({ ...json, host });
      expect(answer.status, host).toBe(401);
    }
  });
});

describe('MCP logs (02 G6)', () => {
  it('masks personal data the SDK echoes from a request into its error logs', async () => {
    await rawRequest({
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${await mint()}`,
      'mcp-protocol-version': `${PLANTED_PHONE}-${PLANTED_PAN}`,
    });
    expect(logs.some((l) => l.event === 'mcp_error')).toBe(true);
    expect(JSON.stringify(logs)).not.toMatch(/\d{8}/);
  });

  it('logs every refused request with its reason and nothing the caller sent', async () => {
    const json = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    const forged = await mint({ key: WEBHOOK_SECRET });
    await rawRequest({ ...json, host: `evil-${PLANTED_PAN}.example` });
    await rawRequest({ ...json, origin: 'http://evil.example' });
    await rawRequest(json);
    await rawRequest({ ...json, authorization: `Bearer ${forged}` });
    const refused = logs.filter((line) => line.event === 'auth_rejected');
    expect(refused).toEqual([
      { event: 'auth_rejected', reason: 'host' },
      { event: 'auth_rejected', reason: 'origin' },
      { event: 'auth_rejected', reason: 'missing_token' },
      { event: 'auth_rejected', reason: 'invalid_token' },
    ]);
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain(forged);
    expect(logged).not.toContain('evil');
  });
});

describe('MCP authentication (02 G4)', () => {
  it('answers health without a token', async () => {
    const response = await fetch(mcpUrl.replace('/mcp', '/health'));
    expect(response.status).toBe(200);
  });

  it('reads the Bearer scheme case-insensitively (RFC 7235)', async () => {
    const answer = await rawRequest({
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `bearer ${await mint()}`,
    });
    expect(answer.status).toBe(200);
  });

  it('refuses a request without a bearer token', async () => {
    const response = await rawPost();
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toMatch(/^Bearer/);
  });

  const rejected: [string, () => Promise<string>][] = [
    ['an expired token', () => mint({ issuedAt: now() - PAST_S })],
    [
      'a recently issued token whose exp has passed',
      () => mint({ issuedAt: now() - EXPIRED_AGO_S, expiresAt: now() - 1 }),
    ],
    [
      'a token for another resource',
      () => mint({ audience: 'http://other.internal/mcp' }),
    ],
    ['a token from another issuer', () => mint({ issuer: 'someone-else' })],
    [
      'a token signed with the webhook secret',
      () => mint({ key: WEBHOOK_SECRET }),
    ],
    [
      'a token without the case:read scope',
      () => mint({ scope: 'case:write' }),
    ],
    [
      'a token that lives longer than ten minutes',
      () => mint({ expiresAt: now() + TOO_LONG_TTL_S }),
    ],
    [
      'an unsigned alg:none token',
      () =>
        Promise.resolve(
          new UnsecuredJWT({
            case_id: CASE_ID,
            run_id: RUN_ID,
            scope: CASE_TOKEN_SCOPE,
          })
            .setIssuer(CASE_TOKEN_ISSUER)
            .setAudience(AUDIENCE)
            .setSubject(OWNER)
            .setJti('jti_none')
            .setIssuedAt()
            .setExpirationTime(now() + TOKEN_TTL_S)
            .encode(),
        ),
    ],
    [
      'a token audienced to the connection URL',
      () => mint({ audience: mcpUrl }),
    ],
  ];

  it.each(rejected)(
    'refuses %s with 401 and WWW-Authenticate: Bearer',
    async (_, token) => {
      const response = await rawPost(await token());
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toMatch(/^Bearer/);
    },
  );

  it.each([MODERN, LEGACY] as const)(
    'serves a %s client with a valid case token',
    async (era) => {
      const client = await connect(await mint(), era);
      expect(client.getNegotiatedProtocolVersion()).toBe(era);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(TOOL_ORDER.length);
      expect((await call(client, 'get_customer')).isError).toBe(false);
      expect(logs.filter((line) => line.event === 'auth_rejected')).toEqual([]);
      await client.close();
    },
  );
});

describe('MCP tools (01 §Tools, 02 G4)', () => {
  it('lists the four read-only tools in a fixed order, none taking customer_id', async () => {
    const client = await connect(await mint());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(TOOL_ORDER);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject(READ_ONLY);
      expect(JSON.stringify(tool.inputSchema)).not.toContain('customer_id');
      expect(tool.inputSchema, tool.name).toMatchObject({
        additionalProperties: false,
      });
    }
    const [, list, spei] = tools;
    expect(list?.inputSchema).toMatchObject({
      properties: { from: { format: 'date-time' }, limit: { maximum: 25 } },
    });
    expect(spei?.inputSchema).toMatchObject({ required: ['transaction_id'] });
    expect(JSON.stringify(spei?.inputSchema)).toContain('"pattern":"^tx_');
    await client.close();
  });

  it('returns outputs that parse with their contract schemas, in the contract order', async () => {
    expect(TOOL_ORDER).toEqual([...MCP_TOOL_NAMES]);
    const client = await connect(await mint());
    const outputs = [
      [CustomerViewSchema, await call(client, 'get_customer')],
      [TransactionPageSchema, await call(client, 'list_transactions')],
      [
        SpeiStatusSchema,
        await call(client, 'get_spei_status', { transaction_id: speiOut.id }),
      ],
      [
        CardAuthorizationSchema,
        await call(client, 'get_card_authorization', {
          transaction_id: cardCharge.id,
        }),
      ],
    ] as const;
    for (const [schema, { isError, body }] of outputs) {
      expect(isError).toBe(false);
      expect(schema.safeParse(body).success).toBe(true);
    }
    await client.close();
  });

  it('resolves the customer from the token and returns the first name only', async () => {
    const client = await connect(await mint());
    const { isError, body } = await call(client, 'get_customer');
    expect(isError).toBe(false);
    expect(body).toEqual({
      first_name: 'Ana',
      account_status: 'active',
      kyc_level: 'N3',
      clabe: 'CLABE ••••1788',
      card_last4: '2617',
      card_status: 'active',
    });
    await client.close();
  });

  it('lists only the token customer’s transactions as compact masked rows', async () => {
    const client = await connect(await mint());
    const { body } = await call(client, 'list_transactions', { limit: 25 });
    expect(body).toEqual({
      items: [
        {
          id: 'tx_cu01a',
          type: 'card_purchase',
          status: 'settled',
          amount: 899,
          created_at: '2026-10-03T22:10:00-06:00',
          merchant_descriptor: 'PAYPAL *DIGITALGOODS',
          channel: 'card_not_present',
          auth_factors: 1,
        },
        {
          id: 'tx_so02a',
          type: 'spei_out',
          status: 'returned',
          amount: 12000,
          created_at: '2026-10-02T11:20:00-06:00',
          counterparty_first_name: 'María',
          counterparty_clabe: 'CLABE ••••3213',
        },
      ],
      total: 2,
      next_cursor: null,
      truncated: false,
    });
    await client.close();
  });

  it('passes filters and pagination through and marks a truncated page', async () => {
    const client = await connect(await mint());
    const { body } = await call(client, 'list_transactions', { limit: 1 });
    expect(body).toMatchObject({ total: 2, next_cursor: '1', truncated: true });
    const filtered = await call(client, 'list_transactions', {
      type: 'spei_out',
      query: 'maría',
    });
    expect(filtered.body).toMatchObject({ total: 1 });
    await client.close();
  });

  it('filters by an inclusive range of offset datetimes and refuses a bare date', async () => {
    const client = await connect(await mint());
    const day = await call(client, 'list_transactions', {
      from: '2026-10-02T00:00:00-06:00',
      to: '2026-10-02T23:59:59-06:00',
    });
    expect(day.body).toMatchObject({ total: 1, items: [{ id: speiOut.id }] });
    expect(
      await call(client, 'list_transactions', {
        from: '2026-10-02',
        to: '2026-10-02',
      }),
    ).toEqual({
      isError: true,
      body: { error: 'INVALID_ARGUMENTS', fields: ['from', 'to'] },
    });
    await client.close();
  });

  it('refuses a transaction id outside the registry format without calling core', async () => {
    const client = await connect(await mint());
    for (const transaction_id of [
      '..',
      'tx_../customers',
      '4111111111111111',
    ]) {
      expect(
        await call(client, 'get_spei_status', { transaction_id }),
        transaction_id,
      ).toEqual({
        isError: true,
        body: { error: 'INVALID_ARGUMENTS', fields: ['transaction_id'] },
      });
    }
    expect(upstream).toEqual([]);
    await client.close();
  });

  it('rejects a customer_id argument instead of honoring it', async () => {
    const client = await connect(await mint());
    expect(
      await call(client, 'list_transactions', { customer_id: OTHER }),
    ).toEqual({
      isError: true,
      body: { error: 'INVALID_ARGUMENTS', fields: [] },
    });
    await client.close();
  });

  it('rejects any argument to get_customer instead of ignoring it', async () => {
    const client = await connect(await mint());
    expect(await call(client, 'get_customer', { customer_id: OTHER })).toEqual({
      isError: true,
      body: { error: 'INVALID_ARGUMENTS', fields: [] },
    });
    expect(upstream).toEqual([]);
    await client.close();
  });

  it('masks personal data planted in free-text core fields', async () => {
    const planted: CardTx = {
      ...cardCharge,
      id: 'tx_pii01',
      merchant_descriptor: `PAGO ${PLANTED_PAN}`,
      merchant_brand: `Tel ${PLANTED_PHONE}`,
    };
    await stopAll();
    await startCore([customer(OWNER)], [planted]);
    await startApp();
    const client = await connect(await mint());
    const outputs = [
      await call(client, 'list_transactions'),
      await call(client, 'get_card_authorization', {
        transaction_id: planted.id,
      }),
    ];
    for (const { body } of outputs) {
      expect(JSON.stringify(body)).not.toMatch(/\d{8}/);
    }
    await client.close();
  });

  it('returns SPEI status with only the last four of the tracking key', async () => {
    const client = await connect(await mint());
    const { isError, body } = await call(client, 'get_spei_status', {
      transaction_id: speiOut.id,
    });
    expect(isError).toBe(false);
    expect(body).toEqual({
      id: 'tx_so02a',
      type: 'spei_out',
      status: 'returned',
      amount: 12000,
      created_at: '2026-10-02T11:20:00-06:00',
      settled_at: '2026-10-02T11:20:04-06:00',
      returned_at: '2026-10-02T15:00:00-06:00',
      tracking_key_last4: 'SO2A',
      return_reason: 'cuenta_inexistente',
      hold_reason: null,
      reject_reason: null,
      reversal_credit_id: null,
      cep_available: true,
    });
    expect(JSON.stringify(body)).not.toContain(speiOut.tracking_key);
    await client.close();
  });

  it('returns a card authorization with decision, factors and merchant', async () => {
    const client = await connect(await mint());
    const { body } = await call(client, 'get_card_authorization', {
      transaction_id: cardCharge.id,
    });
    expect(body).toEqual({
      id: 'tx_cu01a',
      status: 'settled',
      decision: 'approved',
      decline_reason: null,
      amount: 899,
      created_at: '2026-10-03T22:10:00-06:00',
      merchant_descriptor: 'PAYPAL *DIGITALGOODS',
      merchant_brand: 'Digital Goods Ltd',
      channel: 'card_not_present',
      auth_factors: 1,
    });
    await client.close();
  });

  it('answers a tool asked about the other kind of transaction with WRONG_TYPE', async () => {
    const client = await connect(await mint());
    const spei = await call(client, 'get_card_authorization', {
      transaction_id: speiOut.id,
    });
    const card = await call(client, 'get_spei_status', {
      transaction_id: cardCharge.id,
    });
    expect([spei, card]).toEqual([
      { isError: true, body: { error: 'WRONG_TYPE' } },
      { isError: true, body: { error: 'WRONG_TYPE' } },
    ]);
    await client.close();
  });

  const lookups = [
    ['get_spei_status', foreignSpei],
    ['get_spei_status', foreignCharge],
    ['get_card_authorization', foreignCharge],
    ['get_card_authorization', foreignSpei],
  ] as const;

  it.each(lookups)(
    '%s answers a foreign id like a missing one, before any type check, and records one event',
    async (tool, foreignTx) => {
      const client = await connect(await mint());
      const foreign = await call(client, tool, {
        transaction_id: foreignTx.id,
      });
      const missing = await call(client, tool, { transaction_id: 'tx_none' });
      expect(foreign).toEqual({ isError: true, body: { error: 'NOT_FOUND' } });
      expect(missing).toEqual(foreign);
      expect(events).toEqual([
        {
          kind: 'cross_customer_lookup',
          case_id: CASE_ID,
          run_id: RUN_ID,
          ref_masked: foreignTx.id,
        },
      ]);
      await client.close();
    },
  );

  it('still answers NOT_FOUND when the sink fails, and logs the failure masked', async () => {
    sinkFailure = new Error(`insert failed for card ${PLANTED_PAN}`);
    const client = await connect(await mint());
    expect(
      await call(client, 'get_card_authorization', {
        transaction_id: foreignCharge.id,
      }),
    ).toEqual({ isError: true, body: { error: 'NOT_FOUND' } });
    const unrecorded = logs.filter(
      (l) => l.event === 'security_event_unrecorded',
    );
    expect(unrecorded).toHaveLength(1);
    expect(JSON.stringify(unrecorded)).not.toMatch(/\d{8}/);
    await client.close();
  });

  it(`refuses call ${CASE_TOKEN_MAX_CALLS + 1} on one jti with RATE_LIMITED`, async () => {
    const token = await mint({ jti: 'jti_busy' });
    const client = await connect(token);
    for (let i = 0; i < CASE_TOKEN_MAX_CALLS; i++) {
      expect((await call(client, 'get_customer')).isError).toBe(false);
    }
    expect(await call(client, 'get_customer')).toEqual({
      isError: true,
      body: { error: 'RATE_LIMITED' },
    });
    const fresh = await connect(await mint());
    expect((await call(fresh, 'get_customer')).isError).toBe(false);
    await client.close();
    await fresh.close();
  });

  it('counts calls with invalid arguments against the per-token budget', async () => {
    const client = await connect(await mint({ jti: 'jti_invalid' }));
    for (let i = 0; i < CASE_TOKEN_MAX_CALLS; i++) {
      await call(client, 'get_spei_status', { transaction_id: '..' });
    }
    expect(await call(client, 'get_customer')).toEqual({
      isError: true,
      body: { error: 'RATE_LIMITED' },
    });
    await client.close();
  });

  it('calls core-mock with its own read key and never forwards the case token', async () => {
    const token = await mint();
    const client = await connect(token);
    await call(client, 'get_customer');
    await call(client, 'get_spei_status', { transaction_id: speiOut.id });
    expect(upstream.length).toBeGreaterThan(0);
    for (const request of upstream) {
      expect(request.headers.get('x-core-key')).toBe(READ_KEY);
      expect(request.headers.get('authorization')).toBeNull();
      expect([...request.headers.values()].join(' ')).not.toContain(token);
      expect(request.url).not.toContain(token);
    }
    await client.close();
  });

  it('turns a malformed core answer into a masked tool error', async () => {
    const client = await connect(await mint());
    stubbed = () => Promise.resolve(new Response(`tel ${PLANTED_PHONE}`));
    const outcome = await client.callTool({
      name: 'get_customer',
      arguments: {},
    });
    expect(outcome.isError).toBe(true);
    expect(JSON.stringify(outcome.content)).not.toMatch(/\d{8}/);
    expect(JSON.stringify(outcome.content)).toContain('UPSTREAM_UNAVAILABLE');
    await client.close();
  });

  it('answers a core record that breaks the contract with UPSTREAM_UNAVAILABLE', async () => {
    const client = await connect(await mint());
    stubbed = () =>
      Promise.resolve(Response.json({ first_name: PLANTED_PHONE }));
    expect(await call(client, 'get_customer')).toEqual({
      isError: true,
      body: { error: 'UPSTREAM_UNAVAILABLE' },
    });
    await client.close();
  });

  it('answers a transaction page outside the contract with UPSTREAM_UNAVAILABLE', async () => {
    const client = await connect(await mint());
    stubbed = () =>
      Promise.resolve(
        Response.json({ items: [{ id: PLANTED_PAN }], total: 1 }),
      );
    expect(await call(client, 'list_transactions')).toEqual({
      isError: true,
      body: { error: 'UPSTREAM_UNAVAILABLE' },
    });
    await client.close();
  });

  it('never turns an ownerless core record into a fraud signal', async () => {
    const client = await connect(await mint());
    const ownerless = Object.fromEntries(
      Object.entries(foreignCharge).filter(([key]) => key !== 'customer_id'),
    );
    stubbed = () => Promise.resolve(Response.json(ownerless));
    expect(
      await call(client, 'get_card_authorization', {
        transaction_id: foreignCharge.id,
      }),
    ).toEqual({ isError: true, body: { error: 'UPSTREAM_UNAVAILABLE' } });
    expect(events).toEqual([]);
    await client.close();
  });

  it('turns a core outage into a tool error, not a crash', async () => {
    const client = await connect(await mint());
    await close(core.server);
    expect(await call(client, 'get_customer')).toEqual({
      isError: true,
      body: { error: 'UPSTREAM_UNAVAILABLE' },
    });
    await client.close();
    await listen(core.server);
  });

  it('logs why core is unavailable with personal data masked', async () => {
    stubbed = () =>
      Promise.reject(new Error('socket hang up near 4111111111111111'));
    const client = await connect(await mint());
    await call(client, 'get_customer');
    const outages = logs.filter((line) => line.event === 'core_unavailable');
    expect(outages).toEqual([
      expect.objectContaining({ tool: 'get_customer', run_id: RUN_ID }),
    ]);
    expect(String(outages[0]?.reason)).toContain('socket hang up');
    expect(JSON.stringify(outages)).not.toMatch(/\d{8}/);
    await client.close();
  });
});

describe('per-token call budget (02 G4)', () => {
  const EXPIRES_AT = 1_000;

  it('refuses every call once the token has expired, even with budget left', () => {
    let clock = EXPIRES_AT - 1;
    const budget = createCallBudget(() => clock);
    expect(budget.take('jti_a', EXPIRES_AT)).toBe(true);
    clock = EXPIRES_AT + 1;
    expect(budget.take('jti_a', EXPIRES_AT)).toBe(false);
    expect(budget.take('jti_b', EXPIRES_AT)).toBe(false);
  });
});

describe('tool failures nobody planned for (02 G6)', () => {
  it('answer INTERNAL with no raw message and log it masked', async () => {
    const failing = new Error(`boom for card ${PLANTED_PAN}`);
    const lines: Record<string, unknown>[] = [];
    const server = new McpServer({ name: 'failing', version: '0.0.0' });
    registerTools(server, {
      claims: {
        iss: CASE_TOKEN_ISSUER,
        aud: AUDIENCE,
        sub: OWNER,
        case_id: CASE_ID,
        run_id: RUN_ID,
        jti: 'jti_failing',
        scope: CASE_TOKEN_SCOPE,
        iat: now(),
        exp: now() + TOKEN_TTL_S,
      },
      core: {
        customer: () => Promise.reject(failing),
        transaction: () => Promise.reject(failing),
        transactions: () => Promise.reject(failing),
      },
      securityEvents: { record: () => Promise.resolve() },
      calls: createCallBudget(),
      log: (line) => lines.push(line),
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'mcp-spec', version: '0.0.0' });
    await client.connect(clientSide);
    expect(await call(client, 'get_customer')).toEqual({
      isError: true,
      body: { error: 'INTERNAL' },
    });
    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines)).not.toMatch(/\d{8}/);
    await client.close();
  });
});
