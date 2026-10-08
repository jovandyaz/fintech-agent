import type { EvalRun } from '@fintech-agent/api/evals';

const DISPUTE_DRAFT =
  'Hola {{nombre}}, abrimos tu aclaración con folio {{folio}}. {{compromiso_dictamen}}';

/** A correct CARD-UNREC-01 dispute attempt, as the stack would persist it. */
export const evalRunOf = (over: Partial<EvalRun> = {}): EvalRun => ({
  case_id: 'case_e1',
  folio: 'AC-EVAL-0001',
  case_status: 'needs_review',
  category: 'unrecognized_card_charge',
  flags: [],
  review_tier: 'high',
  run_id: 'run_e1',
  run_status: 'succeeded',
  stop_reason: 'completed',
  error_code: null,
  model: 'claude-sonnet-5-5',
  prompt_version: 'a1b2c3d4e5f6a7b8',
  cost_usd: 0.05,
  latency_ms: 9000,
  input_tokens: 9000,
  output_tokens: 600,
  steps: 9,
  proposal: {
    type: 'open_dispute',
    transaction_ids: ['tx_cu01a'],
    reason_code: 'unrecognized_charge',
  },
  draft_reply: 'Hola Ana, abrimos tu aclaración con folio AC-EVAL-0001.',
  citations: [{ chunk_id: 'chunk_p04s1', doc_id: 'pol-04' }],
  abstained: false,
  model_outputs: [
    {
      category: 'unrecognized_card_charge',
      draft_reply: DISPUTE_DRAFT,
      citations: [{ chunk_id: 'chunk_p04s1', doc_id: 'pol-04' }],
      proposed_action: {
        type: 'open_dispute',
        transaction_ids: ['tx_cu01a'],
      },
    },
  ],
  validations: [{ outcome: 'passed', codes: [] }],
  tool_calls: [
    { tool: 'get_customer', input: {} },
    { tool: 'get_card_authorization', input: { transaction_id: 'tx_cu01a' } },
  ],
  retrieved_docs: ['pol-04'],
  executions: 0,
  judge_input: { draft_reply: '', cited_chunks: [], tool_outputs: [] },
  ...over,
});
