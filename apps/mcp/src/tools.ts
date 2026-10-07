import {
  CASE_TOKEN_MAX_CALLS,
  GetCustomerInputSchema,
  ListTransactionsInputSchema,
  MAX_LIST_LIMIT,
  maskJson,
  maskPii,
  SPEI_TYPES,
  TransactionLookupInputSchema,
  type CardAuthorization,
  type CaseTokenClaims,
  type CustomerView,
  type McpToolError,
  type McpToolName,
  type SecurityEventKind,
  type SpeiStatus,
  type TransactionPage,
  type TransactionRow,
  type CardTx,
  type SpeiTx,
  type Transaction,
} from '@fintech-agent/contracts';
import type {
  CallToolResult,
  McpServer,
  StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import type { z } from 'zod';

import { READ_ONLY } from './annotations.js';
import { CoreUnavailableError, type CoreClient } from './core-client.js';
import type { SecurityEventSink } from './security-events.js';

const LAST_FOUR = 4;
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
  core: CoreClient;
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

const firstName = (fullName: string): string =>
  fullName.trim().split(/\s+/)[0] ?? '';

const isSpei = (tx: Transaction): tx is SpeiTx =>
  (SPEI_TYPES as readonly string[]).includes(tx.type);

function toRow(tx: Transaction): TransactionRow {
  const base = {
    id: tx.id,
    status: tx.status,
    amount: tx.amount,
    created_at: tx.created_at,
  };
  if (!isSpei(tx)) {
    return {
      ...base,
      type: tx.type,
      merchant_descriptor: tx.merchant_descriptor,
      channel: tx.channel,
      auth_factors: tx.auth_factors,
    };
  }
  return {
    ...base,
    type: tx.type,
    counterparty_first_name: firstName(tx.counterparty_name),
    counterparty_clabe: maskPii(tx.counterparty_clabe),
  };
}

function toSpeiStatus(tx: SpeiTx): SpeiStatus {
  return {
    id: tx.id,
    type: tx.type,
    status: tx.status,
    amount: tx.amount,
    created_at: tx.created_at,
    settled_at: tx.settled_at,
    returned_at: tx.returned_at,
    tracking_key_last4: tx.tracking_key.slice(-LAST_FOUR),
    return_reason: tx.return_reason,
    hold_reason: tx.hold_reason,
    reject_reason: tx.reject_reason,
    reversal_credit_id: tx.reversal_credit_id,
    cep_available: tx.cep_available,
  };
}

function toCardAuthorization(tx: CardTx): CardAuthorization {
  return {
    id: tx.id,
    status: tx.status,
    decision: tx.status === 'rejected' ? 'declined' : 'approved',
    decline_reason: tx.decline_reason,
    amount: tx.amount,
    created_at: tx.created_at,
    merchant_descriptor: tx.merchant_descriptor,
    merchant_brand: tx.merchant_brand,
    channel: tx.channel,
    auth_factors: tx.auth_factors,
  };
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
      description:
        'The case customer: first name, account status, KYC level, masked CLABE, card last four and card status.',
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
          card_last4: customer.card_pan.slice(-LAST_FOUR),
          card_status: customer.card_status,
        };
      }),
  );

  server.registerTool(
    LIST_TRANSACTIONS,
    {
      description: `The case customer’s transactions, newest first, as compact rows. Filter by type, status, an inclusive date range (from/to, ISO 8601 datetimes with offset such as 2026-10-02T00:00:00-06:00), amount range or a text query on the merchant or counterparty; page with limit (max ${MAX_LIST_LIMIT}) and cursor. \`total\` says how many match.`,
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
          items: page.items.map(toRow),
          total: page.total,
          next_cursor: page.next_cursor,
          truncated: page.next_cursor !== null,
        };
      }),
  );

  server.registerTool(
    GET_SPEI_STATUS,
    {
      description:
        'State of one SPEI transfer of the case customer: timestamps, last four of the tracking key, return, hold or reject reason, the reversal credit of a returned outgoing transfer, and whether a CEP is available.',
      inputSchema: advertised(TransactionLookupInputSchema),
      annotations: READ_ONLY,
    },
    (args) =>
      guarded(GET_SPEI_STATUS, async (): Promise<SpeiStatus> => {
        const { transaction_id } = parse(TransactionLookupInputSchema, args);
        const tx = await ownTransaction(transaction_id);
        if (!isSpei(tx)) throw new ToolFailure(TOOL_ERROR.wrongType);
        return toSpeiStatus(tx);
      }),
  );

  server.registerTool(
    GET_CARD_AUTHORIZATION,
    {
      description:
        'Authorization of one card purchase of the case customer: decision, decline reason, merchant descriptor and brand, channel and the number of independent authentication factors (3DS counts here).',
      inputSchema: advertised(TransactionLookupInputSchema),
      annotations: READ_ONLY,
    },
    (args) =>
      guarded(GET_CARD_AUTHORIZATION, async (): Promise<CardAuthorization> => {
        const { transaction_id } = parse(TransactionLookupInputSchema, args);
        const tx = await ownTransaction(transaction_id);
        if (isSpei(tx)) throw new ToolFailure(TOOL_ERROR.wrongType);
        return toCardAuthorization(tx);
      }),
  );
}
