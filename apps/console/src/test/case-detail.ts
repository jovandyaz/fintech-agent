import type {
  CaseDetail,
  RunView,
  TransactionRow,
} from '@fintech-agent/contracts/console';

/** A card charge the customer does not recognize; the agent's proposed dispute names it. */
export const CARD_CHARGE: TransactionRow = {
  id: 'tx_card01',
  type: 'card_purchase',
  status: 'settled',
  amount: 899,
  created_at: '2026-10-01T18:00:00.000Z',
  merchant_descriptor: 'PAYPAL *TIENDA',
  channel: 'card_not_present',
  auth_factors: 1,
};

/** A second charge the operator may add or swap in. */
export const OTHER_CHARGE: TransactionRow = {
  ...CARD_CHARGE,
  id: 'tx_card02',
  amount: 1250,
  merchant_descriptor: 'NETFLIX.COM',
};

/** An outgoing SPEI, the only transaction a CEP can be resent for. */
export const SPEI_OUT: TransactionRow = {
  id: 'tx_spei01',
  type: 'spei_out',
  status: 'settled',
  amount: 3000,
  created_at: '2026-09-28T15:30:00.000Z',
  counterparty_first_name: 'Luis',
  counterparty_clabe: '[CLABE ****1234]',
};

/** One finished run with a step of each kind. */
export const RUN: RunView = {
  run_id: 'run_abc',
  status: 'succeeded',
  stop_reason: 'completed',
  error_code: null,
  model: 'claude-sonnet-5-5',
  input_tokens: 5200,
  output_tokens: 640,
  cost_usd: '0.0231',
  latency_ms: 8400,
  steps: [
    {
      idx: 0,
      kind: 'guard',
      name: 'redaction',
      input: null,
      output: { outcome: 'passed' },
      latency_ms: 900,
      cost_usd: '0.0010',
    },
    {
      idx: 1,
      kind: 'tool',
      name: 'list_transactions',
      input: { limit: 25 },
      output: { items: [{ id: CARD_CHARGE.id, amount: 899 }], total: 1 },
      latency_ms: 120,
      cost_usd: null,
    },
    {
      idx: 2,
      kind: 'retrieval',
      name: 'search_policies',
      input: { query: 'cargo no reconocido' },
      output: { chunks: [{ chunk_id: 'pol-03#2' }] },
      latency_ms: 80,
      cost_usd: null,
    },
    {
      idx: 3,
      kind: 'validation',
      name: 'validation',
      input: null,
      output: { outcome: 'repair', codes: ['UNGROUNDED_NUMBER'] },
      latency_ms: null,
      cost_usd: null,
    },
  ],
};

/** An open dispute proposal on a high-tier case with one flag, as `GET /cases/:id` answers it. */
export const detail = (over: Partial<CaseDetail> = {}): CaseDetail => ({
  case: {
    case_id: 'case_abc',
    folio: 'AC-K55M-76NH',
    status: 'needs_review',
    review_tier: 'high',
    flags: ['first_party_signal'],
    category: 'unrecognized_card_charge',
    received_at: '2026-10-07T21:00:00.000Z',
    text: 'No reconozco un cargo de PAYPAL por 899.',
    manual_reruns: 0,
  },
  runs: [RUN],
  resolution: {
    category: 'unrecognized_card_charge',
    draft_reply: 'Hola, abrimos una aclaración por tu cargo.',
    citations: [
      {
        chunk_id: 'pol-03#2',
        doc_id: 'pol-03',
        section: 'Cargos no reconocidos',
        quote: 'El cliente puede pedir la aclaración de un cargo.',
      },
    ],
    abstained: false,
    reasoning_summary: 'El cargo coincide con el texto del cliente.',
  },
  proposal: {
    action_id: 'act_abc',
    type: 'open_dispute',
    params: {
      transaction_ids: [CARD_CHARGE.id],
      reason_code: 'unrecognized_charge',
    },
    justification: 'El cliente no reconoce el cargo de PAYPAL.',
    status: 'proposed',
  },
  override_options: {
    actions: [
      {
        type: 'open_dispute',
        min: 1,
        max: 3,
        transaction_ids: [CARD_CHARGE.id, OTHER_CHARGE.id],
      },
      { type: 'resend_cep', min: 1, max: 1, transaction_ids: [SPEI_OUT.id] },
      {
        type: 'escalate_fraud',
        min: 0,
        max: 5,
        transaction_ids: [CARD_CHARGE.id, OTHER_CHARGE.id, SPEI_OUT.id],
      },
      { type: 'none', min: 0, max: 0, transaction_ids: [] },
    ],
    transactions: [CARD_CHARGE, OTHER_CHARGE, SPEI_OUT],
  },
  ...over,
});
