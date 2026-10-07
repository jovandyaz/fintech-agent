import { createHash, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { DatabaseSync } from 'node:sqlite';

import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  type Customer,
  type Transaction,
} from '@fintech-agent/contracts';
import { z } from 'zod';

const MAX_BODY_BYTES = 64 * 1024;
const COUNTER_RADIX = 36;
const STATUS = {
  ok: 200,
  created: 201,
  badRequest: 400,
  unauthorized: 401,
  notFound: 404,
  payloadTooLarge: 413,
  unprocessable: 422,
  internal: 500,
} as const;
const ERROR = {
  notFound: 'not_found',
  unauthorized: 'unauthorized',
  bodyTooLarge: 'body_too_large',
  invalidJson: 'invalid_json',
  invalidQuery: 'invalid_query',
  invalidBody: 'invalid_body',
  keyRequired: 'idempotency_key_required',
  keyReused: 'idempotency_key_reused',
  notOwned: 'transactions_not_owned',
  internal: 'internal',
} as const;

export const WRITE_ENDPOINTS = {
  '/disputes': 'dsp',
  '/cep/resend': 'cep',
  '/fraud/escalations': 'frd',
} as const;
type WriteEndpoint = keyof typeof WRITE_ENDPOINTS;

const WriteBodySchema = z.strictObject({
  action_id: z.string().min(1),
  customer_id: z.string().min(1),
  transaction_ids: z.array(z.string().min(1)),
  reason_code: z.string().min(1),
});

const ListQuerySchema = z.object({
  type: z.string().optional(),
  status: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  min_amount: z.coerce.number().optional(),
  max_amount: z.coerce.number().optional(),
  query: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_LIMIT)
    .default(DEFAULT_LIST_LIMIT),
  cursor: z.coerce.number().int().min(0).default(0),
});

export interface CoreMockOptions {
  customers: Customer[];
  transactions: Transaction[];
  readKey: string;
  executorKey: string;
  databasePath: string;
  log?: (line: Record<string, unknown>) => void;
}

export interface Effect {
  idempotency_key: string;
  endpoint: WriteEndpoint;
  id: string;
}

export interface CoreMock {
  server: Server;
  effects: () => Effect[];
  close: () => void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const notFound = (): HttpError =>
  new HttpError(STATUS.notFound, ERROR.notFound);

const digest = (value: string): Buffer =>
  createHash('sha256').update(value).digest();

const sameSecret = (given: string | undefined, expected: string): boolean =>
  given !== undefined && timingSafeEqual(digest(given), digest(expected));

const header = (req: IncomingMessage, name: string): string | undefined => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(STATUS.payloadTooLarge, ERROR.bodyTooLarge);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(STATUS.badRequest, ERROR.invalidJson);
  }
}

const searchableText = (t: Transaction): string =>
  t.type === 'card_purchase' ? t.merchant_descriptor : t.counterparty_name;

/**
 * The synthetic core banking API: full-value reads for the MCP server and the
 * executor, and the only write endpoints, which take the executor key and an
 * idempotency key stored under a unique constraint (02 G1, G3).
 */
export function createCoreMock(options: CoreMockOptions): CoreMock {
  const customers = new Map(options.customers.map((c) => [c.id, c]));
  const transactions = new Map(options.transactions.map((t) => [t.id, t]));
  const log = options.log ?? ((line) => console.log(JSON.stringify(line)));

  const db = new DatabaseSync(options.databasePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS effects (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT NOT NULL UNIQUE,
      endpoint TEXT NOT NULL,
      body_hash TEXT NOT NULL,
      id TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT
  `);
  const findEffect = db.prepare(
    'SELECT endpoint, body_hash, response FROM effects WHERE idempotency_key = ?',
  );
  const insertEffect = db.prepare(
    'INSERT INTO effects (idempotency_key, endpoint, body_hash, id, response, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const countEffects = db.prepare('SELECT COUNT(*) AS n FROM effects');
  const listEffects = db.prepare(
    'SELECT idempotency_key, endpoint, id FROM effects ORDER BY seq',
  );

  function requireReader(req: IncomingMessage): void {
    const key = header(req, 'x-core-key');
    const known =
      sameSecret(key, options.readKey) || sameSecret(key, options.executorKey);
    if (!known) throw new HttpError(STATUS.unauthorized, ERROR.unauthorized);
  }

  function listTransactions(
    customerId: string,
    search: URLSearchParams,
  ): unknown {
    const parsed = ListQuerySchema.safeParse(Object.fromEntries(search));
    if (!parsed.success) {
      throw new HttpError(STATUS.badRequest, ERROR.invalidQuery);
    }
    const q = parsed.data;
    const needle = q.query?.toLowerCase();
    const from = q.from === undefined ? undefined : Date.parse(q.from);
    const to = q.to === undefined ? undefined : Date.parse(q.to);
    const rows = [...transactions.values()]
      .filter((t) => t.customer_id === customerId)
      .filter((t) => q.type === undefined || t.type === q.type)
      .filter((t) => q.status === undefined || t.status === q.status)
      .filter((t) => from === undefined || Date.parse(t.created_at) >= from)
      .filter((t) => to === undefined || Date.parse(t.created_at) <= to)
      .filter((t) => q.min_amount === undefined || t.amount >= q.min_amount)
      .filter((t) => q.max_amount === undefined || t.amount <= q.max_amount)
      .filter(
        (t) =>
          needle === undefined ||
          searchableText(t).toLowerCase().includes(needle),
      )
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const items = rows.slice(q.cursor, q.cursor + q.limit);
    const nextOffset = q.cursor + items.length;
    return {
      items,
      total: rows.length,
      next_cursor: nextOffset < rows.length ? String(nextOffset) : null,
    };
  }

  function handleRead(req: IncomingMessage, url: URL): unknown {
    requireReader(req);
    const [, resource, id, sub] = url.pathname.split('/');
    if (!id) throw notFound();
    if (resource === 'customers' && sub === undefined) {
      const found = customers.get(id);
      if (!found) throw notFound();
      return found;
    }
    if (resource === 'customers' && sub === 'transactions') {
      if (!customers.has(id)) throw notFound();
      return listTransactions(id, url.searchParams);
    }
    if (resource === 'transactions' && sub === undefined) {
      const found = transactions.get(id);
      if (!found) throw notFound();
      return found;
    }
    throw notFound();
  }

  async function handleWrite(
    req: IncomingMessage,
    endpoint: WriteEndpoint,
  ): Promise<unknown> {
    if (!sameSecret(header(req, 'x-executor-key'), options.executorKey)) {
      throw new HttpError(STATUS.unauthorized, ERROR.unauthorized);
    }
    const key = header(req, 'idempotency-key');
    if (!key) throw new HttpError(STATUS.badRequest, ERROR.keyRequired);
    const parsed = WriteBodySchema.safeParse(parseJson(await readBody(req)));
    if (!parsed.success) {
      throw new HttpError(STATUS.badRequest, ERROR.invalidBody);
    }
    const body = parsed.data;
    const bodyHash = digest(JSON.stringify(body)).toString('hex');

    const existing = findEffect.get(key) as
      { endpoint: string; body_hash: string; response: string } | undefined;
    if (existing) {
      if (existing.endpoint !== endpoint || existing.body_hash !== bodyHash) {
        throw new HttpError(STATUS.unprocessable, ERROR.keyReused);
      }
      return JSON.parse(existing.response);
    }

    const owned = body.transaction_ids.every(
      (id) => transactions.get(id)?.customer_id === body.customer_id,
    );
    if (!customers.has(body.customer_id) || !owned) {
      throw new HttpError(STATUS.unprocessable, ERROR.notOwned);
    }

    const { n } = countEffects.get() as { n: number };
    const id = `${WRITE_ENDPOINTS[endpoint]}_${(n + 1).toString(COUNTER_RADIX)}`;
    const response = {
      id,
      action_id: body.action_id,
      transaction_ids: body.transaction_ids,
      status: 'accepted',
    };
    insertEffect.run(
      key,
      endpoint,
      bodyHash,
      id,
      JSON.stringify(response),
      new Date().toISOString(),
    );
    log({ event: 'core_write', endpoint, id, action_id: body.action_id });
    return response;
  }

  async function route(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://core-mock');
    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, STATUS.ok, { status: 'ok' });
      return;
    }
    if (req.method === 'GET') {
      send(res, STATUS.ok, handleRead(req, url));
      return;
    }
    if (req.method === 'POST' && url.pathname in WRITE_ENDPOINTS) {
      const endpoint = url.pathname as WriteEndpoint;
      send(res, STATUS.created, await handleWrite(req, endpoint));
      return;
    }
    throw notFound();
  }

  const server = createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) {
        send(res, error.status, { error: error.code });
        return;
      }
      log({ event: 'core_error', message: String(error) });
      send(res, STATUS.internal, { error: ERROR.internal });
    });
  });

  return {
    server,
    effects: () => listEffects.all() as unknown as Effect[],
    close: () => db.close(),
  };
}
