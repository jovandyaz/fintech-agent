import {
  CASE_TOKEN_MAX_CALLS,
  cardAuthorizationOf,
  isSpeiRecord,
  LAST_FOUR_DIGITS,
  speiStatusOf,
  transactionRowOf,
  CoreUnavailableError,
  GetCustomerInputSchema,
  ListTransactionsInputSchema,
  MCP_TOOL_DESCRIPTIONS,
  maskJson,
  maskPii,
  TransactionLookupInputSchema,
  type CardAuthorization,
  type CaseTokenClaims,
  type CoreClient,
  type CustomerView,
  type McpToolError,
  type McpToolName,
  type SecurityEventKind,
  type SpeiStatus,
  type TransactionPage,
  type Transaction,
} from '@fintech-agent/contracts';
import type {
  CallToolResult,
  McpServer,
  StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import type { z } from 'zod';

import { READ_ONLY } from './annotations.js';
import type { SecurityEventSink } from './security-events.js';

const GET_CUSTOMER = 'get_customer' satisfies McpToolName;
const LIST_TRANSACTIONS = 'list_transactions' satisfies McpToolName;
const GET_SPEI_STATUS = 'get_spei_status' satisfies McpToolName;
const GET_CARD_AUTHORIZATION = 'get_card_authorization' satisfies McpToolName;
const CROSS_CUSTOMER_LOOKUP =
  'cross_customer_lookup' satisfies SecurityEventKind;
const ADVERTISED_VENDOR = 'case-copilot';
const MS_PER_SECOND = 1000;
const TOOL_ERROR = {
  notFound: 'NOT_FOUND',
  wrongType: 'WRONG_TYPE',
  rateLimited: 'RATE_LIMITED',
  upstream: 'UPSTREAM_UNAVAILABLE',
  internal: 'INTERNAL',
  invalidArguments: 'INVALID_ARGUMENTS',
} as const satisfies Record<string, McpToolError>;

/** Counts tool calls per case token `jti`; entries are dropped once their token has expired. */
export interface CallBudget {
  take: (jti: string, expiresAt: number) => boolean;
}

export function createCallBudget(
  nowSeconds: () => number = () => Date.now() / MS_PER_SECOND,
): CallBudget {
  const used = new Map<string, { count: number; expiresAt: number }>();
  return {
    take(jti, expiresAt) {
      const now = nowSeconds();
      if (expiresAt <= now) return false;
      for (const [key, entry] of used) {
        if (entry.expiresAt < now) used.delete(key);
      }
      const entry = used.get(jti) ?? { count: 0, expiresAt };
      entry.count += 1;
      used.set(jti, entry);
      return entry.count <= CASE_TOKEN_MAX_CALLS;
    },
  };
}

export interface ToolContext {
  claims: CaseTokenClaims;
  // A tool reads the case's one customer; listing customers is the console's (02 G4).
  core: Pick<CoreClient, 'customer' | 'transaction' | 'transactions'>;
  securityEvents: SecurityEventSink;
  calls: CallBudget;
  log: (line: Record<string, unknown>) => void;
}

class ToolFailure extends Error {
  constructor(
    readonly code: McpToolError,
    readonly fields?: string[],
  ) {
    super(code);
  }
}

const text = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
});

const failure = (code: McpToolError, fields?: string[]): CallToolResult => ({
  ...text(fields === undefined ? { error: code } : { error: code, fields }),
  isError: true,
});

// Publishes the schema's JSON Schema in `tools/list` but lets every argument
// through the SDK, which would otherwise answer bad input with free text outside
// the closed error set and before the call budget; `parse` validates instead.
function advertised<T>(schema: z.ZodType<T>): StandardSchemaWithJSON {
  return {
    '~standard': {
      version: 1,
      vendor: ADVERTISED_VENDOR,
      validate: (value: unknown) => ({ value }),
      jsonSchema: schema['~standard'].jsonSchema,
    },
  };
}

// Field paths only, never values or unknown key names, so the reply cannot echo input.
function parse<T>(schema: z.ZodType<T>, args: unknown): T {
  const result = schema.safeParse(args ?? {});
  if (result.success) return result.data;
  const fields = result.error.issues
    .map((issue) => issue.path.join('.'))
    .filter((path) => path.length > 0);
  throw new ToolFailure(TOOL_ERROR.invalidArguments, [...new Set(fields)]);
}

/**
 * Registers the four read-only tools, in the fixed `tools/list` order, bound
 * to the customer in the verified case token. No tool takes a customer id;
 * another customer's transaction is answered like a missing one and recorded
 * as a security event (02 G4). Every output goes through `maskJson`.
 */
export function registerTools(server: McpServer, ctx: ToolContext): void {
  const { claims, core } = ctx;

  async function guarded(
    tool: McpToolName,
    run: () => Promise<unknown>,
  ): Promise<CallToolResult> {
    if (!ctx.calls.take(claims.jti, claims.exp)) {
      return failure(TOOL_ERROR.rateLimited);
    }
    try {
      return text(maskJson(await run()));
    } catch (error) {
      if (error instanceof ToolFailure) {
        return failure(error.code, error.fields);
      }
      if (error instanceof CoreUnavailableError) {
        ctx.log({
          event: 'core_unavailable',
          tool,
          run_id: claims.run_id,
          reason: maskPii(error.message),
        });
        return failure(TOOL_ERROR.upstream);
      }
      // The SDK would put the raw message in the tool result, unmasked (G6).
      ctx.log({
        event: 'tool_failed',
        tool,
        run_id: claims.run_id,
        message: maskPii(String(error)),
      });
      return failure(TOOL_ERROR.internal);
    }
  }

  async function ownTransaction(id: string): Promise<Transaction> {
    const tx = await core.transaction(id);
    if (tx === null) throw new ToolFailure(TOOL_ERROR.notFound);
    if (tx.customer_id !== claims.sub) {
      const event = {
        kind: CROSS_CUSTOMER_LOOKUP,
        case_id: claims.case_id,
        run_id: claims.run_id,
        ref_masked: maskPii(id),
      } as const;
      await ctx.securityEvents.record(event).catch((error: unknown) => {
        ctx.log({
          event: 'security_event_unrecorded',
          ...event,
          error: maskPii(String(error)),
        });
      });
      throw new ToolFailure(TOOL_ERROR.notFound);
    }
    return tx;
  }

  server.registerTool(
    GET_CUSTOMER,
    {
      description: MCP_TOOL_DESCRIPTIONS[GET_CUSTOMER],
      inputSchema: advertised(GetCustomerInputSchema),
      annotations: READ_ONLY,
    },
    (args) =>
      guarded(GET_CUSTOMER, async (): Promise<CustomerView> => {
        parse(GetCustomerInputSchema, args);
        const customer = await core.customer(claims.sub);
        if (customer === null) throw new ToolFailure(TOOL_ERROR.notFound);
        return {
          first_name: customer.first_name,
          account_status: customer.account_status,
          kyc_level: customer.kyc_level,
          clabe: maskPii(customer.clabe),
          card_last4: customer.card_pan.slice(-LAST_FOUR_DIGITS),
          card_status: customer.card_status,
        };
      }),
  );

  server.registerTool(
    LIST_TRANSACTIONS,
    {
      description: MCP_TOOL_DESCRIPTIONS[LIST_TRANSACTIONS],
      inputSchema: advertised(ListTransactionsInputSchema),
      annotations: READ_ONLY,
    },
    (args) =>
      guarded(LIST_TRANSACTIONS, async (): Promise<TransactionPage> => {
        const input = parse(ListTransactionsInputSchema, args);
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(input)) {
          if (value !== undefined) query.set(key, String(value));
        }
        const page = await core.transactions(claims.sub, query);
        if (page === null) throw new ToolFailure(TOOL_ERROR.notFound);
        return {
          items: page.items.map(transactionRowOf),
          total: page.total,
          next_cursor: page.next_cursor,
          truncated: page.next_cursor !== null,
        };
      }),
  );

  server.registerTool(
    GET_SPEI_STATUS,
    {
      description: MCP_TOOL_DESCRIPTIONS[GET_SPEI_STATUS],
      inputSchema: advertised(TransactionLookupInputSchema),
      annotations: READ_ONLY,
    },
    (args) =>
      guarded(GET_SPEI_STATUS, async (): Promise<SpeiStatus> => {
        const { transaction_id } = parse(TransactionLookupInputSchema, args);
        const tx = await ownTransaction(transaction_id);
        if (!isSpeiRecord(tx)) throw new ToolFailure(TOOL_ERROR.wrongType);
        return speiStatusOf(tx);
      }),
  );

  server.registerTool(
    GET_CARD_AUTHORIZATION,
    {
      description: MCP_TOOL_DESCRIPTIONS[GET_CARD_AUTHORIZATION],
      inputSchema: advertised(TransactionLookupInputSchema),
      annotations: READ_ONLY,
    },
    (args) =>
      guarded(GET_CARD_AUTHORIZATION, async (): Promise<CardAuthorization> => {
        const { transaction_id } = parse(TransactionLookupInputSchema, args);
        const tx = await ownTransaction(transaction_id);
        if (isSpeiRecord(tx)) throw new ToolFailure(TOOL_ERROR.wrongType);
        return cardAuthorizationOf(tx);
      }),
  );
}
