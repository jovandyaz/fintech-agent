import {
  CASE_TOKEN_MAX_CALLS,
  ListTransactionsInputSchema,
  maskJson,
  maskPii,
  TransactionLookupInputSchema,
  type CardAuthorization,
  type CaseTokenClaims,
  type CustomerView,
  type McpToolError,
  type McpToolName,
  type SpeiStatus,
  type TransactionPage,
  type TransactionRow,
} from '@fintech-agent/contracts';
import type { CardTx, SpeiTx, Transaction } from '@fintech-agent/data';
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';

import { READ_ONLY } from './annotations.js';
import { CoreUnavailableError, type CoreClient } from './core-client.js';
import type { SecurityEventSink } from './security-events.js';

const LAST_FOUR = 4;
const MS_PER_SECOND = 1000;
const TOOL_ERROR = {
  notFound: 'NOT_FOUND',
  wrongType: 'WRONG_TYPE',
  rateLimited: 'RATE_LIMITED',
  upstream: 'UPSTREAM_UNAVAILABLE',
  internal: 'INTERNAL',
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
  constructor(readonly code: McpToolError) {
    super(code);
  }
}

const text = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
});

const failure = (code: McpToolError): CallToolResult => ({
  ...text({ error: code }),
  isError: true,
});

const firstName = (fullName: string): string =>
  fullName.trim().split(/\s+/)[0] ?? '';

const isSpei = (tx: Transaction): tx is SpeiTx => tx.type !== 'card_purchase';

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
      if (error instanceof ToolFailure) return failure(error.code);
      if (error instanceof CoreUnavailableError) {
        ctx.log({ event: 'core_unavailable', tool, run_id: claims.run_id });
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
        kind: 'cross_customer_lookup',
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
    'get_customer',
    {
      description:
        'The case customer: first name, account status, KYC level, masked CLABE, card last four and card status.',
      annotations: READ_ONLY,
    },
    () =>
      guarded('get_customer', async (): Promise<CustomerView> => {
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
    'list_transactions',
    {
      description:
        'The case customer’s transactions, newest first, as compact rows. Filter by type, status, an inclusive date range (from/to, ISO 8601 datetimes with offset such as 2026-10-02T00:00:00-06:00), amount range or a text query on the merchant or counterparty; page with limit (max 25) and cursor. `total` says how many match.',
      inputSchema: ListTransactionsInputSchema,
      annotations: READ_ONLY,
    },
    (args) =>
      guarded('list_transactions', async (): Promise<TransactionPage> => {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(args)) {
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
    'get_spei_status',
    {
      description:
        'State of one SPEI transfer of the case customer: timestamps, last four of the tracking key, return, hold or reject reason, the reversal credit of a returned outgoing transfer, and whether a CEP is available.',
      inputSchema: TransactionLookupInputSchema,
      annotations: READ_ONLY,
    },
    ({ transaction_id }) =>
      guarded('get_spei_status', async (): Promise<SpeiStatus> => {
        const tx = await ownTransaction(transaction_id);
        if (!isSpei(tx)) throw new ToolFailure(TOOL_ERROR.wrongType);
        return toSpeiStatus(tx);
      }),
  );

  server.registerTool(
    'get_card_authorization',
    {
      description:
        'Authorization of one card purchase of the case customer: decision, decline reason, merchant descriptor and brand, channel and the number of independent authentication factors (3DS counts here).',
      inputSchema: TransactionLookupInputSchema,
      annotations: READ_ONLY,
    },
    ({ transaction_id }) =>
      guarded(
        'get_card_authorization',
        async (): Promise<CardAuthorization> => {
          const tx = await ownTransaction(transaction_id);
          if (isSpei(tx)) throw new ToolFailure(TOOL_ERROR.wrongType);
          return toCardAuthorization(tx);
        },
      ),
  );
}
