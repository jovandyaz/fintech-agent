import {
  CardAuthorizationSchema,
  CustomerViewSchema,
  SearchPoliciesOutputSchema,
  SpeiStatusSchema,
  TransactionPageSchema,
  type CardAuthorization,
  type CardChannel,
  type CustomerView,
  type McpToolName,
  type PolicyChunk,
  type SpeiStatus,
  type TransactionRow,
  type TxStatus,
  type TxType,
} from '@fintech-agent/contracts';

import type { z } from 'zod';

import { CARD_PURCHASE } from '../../../actions/allowed.js';

export const POLICY_SEARCH_TOOL = 'search_policies';
export type ToolName = McpToolName | typeof POLICY_SEARCH_TOOL;

/** A successful tool result as the run received it, before any parsing. */
export interface ToolResult {
  tool: ToolName;
  output: unknown;
}

/** What the harness hands the validator about one run. */
export interface RunFacts {
  toolResults: readonly ToolResult[];
  receivedAt: Date;
  now: Date;
  /** The intake flag of the heuristic injection scan. */
  injectionSignal: boolean;
  /** A `cross_customer_lookup` row exists in `security_events` for the run. */
  crossCustomerLookup: boolean;
}

/** One transaction as the run saw it, the status outputs winning over list rows. */
export interface SeenTransaction {
  id: string;
  type: TxType;
  status: TxStatus;
  amount: number;
  created_at: string;
  channel: CardChannel | null;
  merchant: string | null;
  auth_factors: number | null;
}

export interface RunEvidence extends Omit<RunFacts, 'toolResults'> {
  transactions: ReadonlyMap<string, SeenTransaction>;
  speiStatuses: ReadonlyMap<string, SpeiStatus>;
  cardAuthorizations: ReadonlyMap<string, CardAuthorization>;
  chunks: ReadonlyMap<string, PolicyChunk>;
  customer: CustomerView | null;
  /** Every MCP output that parsed: with the cited chunks, the only grounding source. */
  outputs: readonly unknown[];
}

const fromRow = (row: TransactionRow): SeenTransaction => {
  const card = row.type === CARD_PURCHASE ? row : null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    amount: row.amount,
    created_at: row.created_at,
    channel: card?.channel ?? null,
    merchant: card?.merchant_descriptor ?? null,
    auth_factors: card?.auth_factors ?? null,
  };
};

const fromSpeiStatus = (status: SpeiStatus): SeenTransaction => ({
  id: status.id,
  type: status.type,
  status: status.status,
  amount: status.amount,
  created_at: status.created_at,
  channel: null,
  merchant: null,
  auth_factors: null,
});

// The card tool answers WRONG_TYPE for anything else, so an authorization
// that parsed is a card purchase.
const fromCardAuthorization = (auth: CardAuthorization): SeenTransaction => ({
  id: auth.id,
  type: CARD_PURCHASE,
  status: auth.status,
  amount: auth.amount,
  created_at: auth.created_at,
  channel: auth.channel,
  merchant: auth.merchant_descriptor,
  auth_factors: auth.auth_factors,
});

/**
 * Parses each tool result against its contracts schema (02 G5: only what the
 * run actually received counts). A result that does not parse is dropped,
 * never trusted, so it can neither ground a number nor satisfy a predicate.
 */
export function buildEvidence(facts: RunFacts): RunEvidence {
  const rows = new Map<string, SeenTransaction>();
  const speiStatuses = new Map<string, SpeiStatus>();
  const cardAuthorizations = new Map<string, CardAuthorization>();
  const chunks = new Map<string, PolicyChunk>();
  const outputs: unknown[] = [];
  let customer: CustomerView | null = null;

  const parse = <T>(schema: z.ZodType<T>, output: unknown): T | null => {
    const parsed = schema.safeParse(output);
    return parsed.success ? parsed.data : null;
  };
  // 02 G5 grounds a number on a tool output or a cited chunk, so retrieved
  // chunks stay out of `outputs` and the validator adds the cited ones.
  const accept = <T>(schema: z.ZodType<T>, output: unknown): T | null => {
    const data = parse(schema, output);
    if (data !== null) outputs.push(data);
    return data;
  };

  for (const { tool, output } of facts.toolResults) {
    switch (tool) {
      case 'get_customer':
        customer = accept(CustomerViewSchema, output) ?? customer;
        break;
      case 'list_transactions':
        for (const row of accept(TransactionPageSchema, output)?.items ?? []) {
          rows.set(row.id, fromRow(row));
        }
        break;
      case 'get_spei_status': {
        const status = accept(SpeiStatusSchema, output);
        if (status) speiStatuses.set(status.id, status);
        break;
      }
      case 'get_card_authorization': {
        const auth = accept(CardAuthorizationSchema, output);
        if (auth) cardAuthorizations.set(auth.id, auth);
        break;
      }
      case POLICY_SEARCH_TOOL:
        for (const chunk of parse(SearchPoliciesOutputSchema, output)?.chunks ??
          []) {
          chunks.set(chunk.chunk_id, chunk);
        }
        break;
    }
  }

  const transactions = new Map(rows);
  for (const status of speiStatuses.values()) {
    transactions.set(status.id, fromSpeiStatus(status));
  }
  for (const auth of cardAuthorizations.values()) {
    transactions.set(auth.id, fromCardAuthorization(auth));
  }

  return {
    receivedAt: facts.receivedAt,
    now: facts.now,
    injectionSignal: facts.injectionSignal,
    crossCustomerLookup: facts.crossCustomerLookup,
    transactions,
    speiStatuses,
    cardAuthorizations,
    chunks,
    customer,
    outputs,
  };
}
