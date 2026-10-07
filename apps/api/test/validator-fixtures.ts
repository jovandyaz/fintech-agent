import type {
  CardAuthorization,
  PolicyChunk,
  Resolution,
  SpeiStatus,
  TransactionRow,
} from '@fintech-agent/contracts';

import type {
  RunFacts,
  ToolResult,
} from '../src/agent/core/validate/evidence.js';

export const RECEIVED_AT = new Date('2026-10-07T15:00:00Z');
export const NOW = new Date('2026-10-07T15:05:00Z');
export const CARD_TX = 'tx_c001';
export const SPEI_TX = 'tx_s001';
const SETTLED = 'settled';
const SPEI_OUT = 'spei_out';
const CARD_CREATED_AT = '2026-10-05T18:00:00Z';
const SPEI_CREATED_AT = '2026-10-05T16:00:00Z';
const MERCHANT = 'AMZN MKTP MX';
const CARD_AMOUNT = 1299.5;
const SPEI_AMOUNT = 2500;

export const cardRow = (
  overrides: Partial<
    Extract<TransactionRow, { merchant_descriptor: string }>
  > = {},
): TransactionRow => ({
  id: CARD_TX,
  type: 'card_purchase',
  status: SETTLED,
  amount: CARD_AMOUNT,
  created_at: CARD_CREATED_AT,
  merchant_descriptor: MERCHANT,
  channel: 'card_not_present',
  auth_factors: 1,
  ...overrides,
});

export const speiRow = (
  overrides: Partial<
    Extract<TransactionRow, { counterparty_clabe: string }>
  > = {},
): TransactionRow => ({
  id: SPEI_TX,
  type: SPEI_OUT,
  status: SETTLED,
  amount: SPEI_AMOUNT,
  created_at: SPEI_CREATED_AT,
  counterparty_first_name: 'Luis',
  counterparty_clabe: 'CLABE ••••7781',
  ...overrides,
});

export const speiStatus = (
  overrides: Partial<SpeiStatus> = {},
): SpeiStatus => ({
  id: SPEI_TX,
  type: SPEI_OUT,
  status: SETTLED,
  amount: SPEI_AMOUNT,
  created_at: SPEI_CREATED_AT,
  settled_at: '2026-10-05T16:00:05Z',
  returned_at: null,
  tracking_key_last4: '7781',
  return_reason: null,
  hold_reason: null,
  reject_reason: null,
  reversal_credit_id: null,
  cep_available: true,
  ...overrides,
});

export const cardAuth = (
  overrides: Partial<CardAuthorization> = {},
): CardAuthorization => ({
  id: CARD_TX,
  status: SETTLED,
  amount: CARD_AMOUNT,
  created_at: CARD_CREATED_AT,
  decision: 'approved',
  decline_reason: null,
  merchant_descriptor: MERCHANT,
  merchant_brand: 'Amazon',
  channel: 'card_not_present',
  auth_factors: 1,
  ...overrides,
});

export const POLICY_CHUNK_ID = 'chunk_p04s2';

export const policyChunk = (
  overrides: Partial<PolicyChunk> = {},
): PolicyChunk => ({
  chunk_id: POLICY_CHUNK_ID,
  doc_id: 'pol-04',
  section: 'Plazos',
  content:
    'El abono de un cargo no reconocido se hace a más tardar el segundo día hábil. El dictamen se entrega en 45 días.',
  ...overrides,
});

export const listed = (...items: TransactionRow[]): ToolResult => ({
  tool: 'list_transactions',
  output: { items, total: items.length, next_cursor: null, truncated: false },
});

export const searched = (...chunks: PolicyChunk[]): ToolResult => ({
  tool: 'search_policies',
  output: { chunks },
});

export const customerSeen: ToolResult = {
  tool: 'get_customer',
  output: {
    first_name: 'Ana',
    account_status: 'active',
    kyc_level: 'N2',
    clabe: 'CLABE ••••1234',
    card_last4: '4321',
    card_status: 'active',
  },
};

export const runOf = (
  toolResults: ToolResult[],
  overrides: Partial<Omit<RunFacts, 'toolResults'>> = {},
): RunFacts => ({
  toolResults,
  receivedAt: RECEIVED_AT,
  now: NOW,
  injectionSignal: false,
  crossCustomerLookup: false,
  ...overrides,
});

export const resolutionOf = (
  overrides: Partial<Resolution> = {},
): Resolution => ({
  category: 'unrecognized_card_charge',
  draft_reply:
    'Hola {{nombre}}, registramos tu aclaración con folio {{folio}}. {{compromiso_dictamen}}',
  citations: [
    {
      chunk_id: POLICY_CHUNK_ID,
      doc_id: 'pol-04',
      section: 'Plazos',
      quote: 'a más tardar el segundo día hábil',
    },
  ],
  abstained: false,
  evidence: [{ kind: 'card_auth', id: CARD_TX }],
  proposed_action: {
    type: 'open_dispute',
    transaction_ids: [CARD_TX],
    reason_code: 'unrecognized_charge',
    justification: 'Cargo sin segundo factor que la clienta no reconoce.',
  },
  reasoning_summary: 'Cargo con un factor; procede la aclaración.',
  ...overrides,
});
