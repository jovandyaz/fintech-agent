import type {
  ActionParams,
  ActionType,
  CaseCategory,
  CaseFlag,
  CaseStatus,
  ReviewTier,
  RunStatus,
  StopReason,
} from '@fintech-agent/contracts';
import { asc, desc, eq, sql } from 'drizzle-orm';

import { claimCase } from '../agent/core/queue.js';
import { runCase, type RunCaseDeps } from '../agent/core/run-case.js';
import type { Database } from '../database/index.js';
import {
  actionExecutions,
  agentRuns,
  cases,
  proposedActions,
  resolutions,
  runSteps,
} from '../database/schema.js';
import { openEvalCase } from './open-eval-case.js';

const LLM = 'llm';
const TOOL = 'tool';
const RETRIEVAL = 'retrieval';
const VALIDATION = 'validation';
const RESOLUTION_KEY = 'proposed_action';

/** One policy chunk a draft cites, with the text the model read. */
export interface CitedChunk {
  doc_id: string;
  section: string;
  text: string;
}

/** What the groundedness judge reads, never the label (03): the filled draft, its cited chunks and the masked tool outputs. */
export interface JudgeInput {
  draft_reply: string;
  cited_chunks: readonly CitedChunk[];
  tool_outputs: readonly { tool: string; output: unknown }[];
}

/** Everything the eval checkers read about one attempt, as the stack persisted it (03 §Metrics). */
export interface EvalRun {
  case_id: string;
  folio: string;
  case_status: CaseStatus;
  category: CaseCategory | null;
  flags: CaseFlag[];
  review_tier: ReviewTier | null;
  run_id: string | null;
  run_status: RunStatus | null;
  stop_reason: StopReason | null;
  error_code: string | null;
  model: string | null;
  prompt_version: string | null;
  cost_usd: number;
  latency_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  steps: number;
  proposal: ({ type: ActionType } & ActionParams) | null;
  draft_reply: string | null;
  citations: { chunk_id: string; doc_id: string }[];
  abstained: boolean | null;
  /** Each structured answer the model returned, in order: the first is the raw output, the last the accepted one. */
  model_outputs: Record<string, unknown>[];
  /** Each validation of a model answer, in order. */
  validations: { outcome: string; codes: string[] }[];
  tool_calls: { tool: string; input: unknown }[];
  retrieved_docs: string[];
  /** `action_executions` rows for the case; anything but 0 is an unauthorized execution, since nobody approves an eval case. */
  executions: number;
  judge_input: JudgeInput;
}

interface StoredChunk {
  chunk_id: string;
  doc_id: string;
  section: string;
  content: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const chunksOf = (output: unknown): StoredChunk[] =>
  isRecord(output) && Array.isArray(output['chunks'])
    ? output['chunks'].filter(
        (chunk): chunk is StoredChunk =>
          isRecord(chunk) &&
          typeof chunk['chunk_id'] === 'string' &&
          typeof chunk['doc_id'] === 'string',
      )
    : [];

const modelAnswerOf = (output: unknown): Record<string, unknown> | null => {
  const text = isRecord(output) ? output['text'] : null;
  return isRecord(text) && RESOLUTION_KEY in text ? text : null;
};

/**
 * Reads back one eval case as the checkers grade it: the case, its latest
 * run with every step, the persisted proposal and resolution, and how many
 * executions it got.
 */
export async function readEvalRun(
  db: Database,
  caseId: string,
): Promise<EvalRun> {
  const [kase] = await db.select().from(cases).where(eq(cases.id, caseId));
  if (!kase) throw new Error(`no eval case ${caseId}`);
  const [run] = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.caseId, caseId))
    .orderBy(desc(agentRuns.startedAt))
    .limit(1);
  const steps = run
    ? await db
        .select()
        .from(runSteps)
        .where(eq(runSteps.runId, run.id))
        .orderBy(asc(runSteps.idx))
    : [];
  const [resolution] = run
    ? await db.select().from(resolutions).where(eq(resolutions.runId, run.id))
    : [];
  const [proposal] = run
    ? await db
        .select()
        .from(proposedActions)
        .where(eq(proposedActions.runId, run.id))
    : [];
  const [executed] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(actionExecutions)
    .innerJoin(
      proposedActions,
      eq(proposedActions.id, actionExecutions.actionId),
    )
    .where(eq(proposedActions.caseId, caseId));

  const toolSteps = steps.filter(({ kind }) => kind === TOOL);
  const seenChunks = new Map(
    steps
      .filter(({ kind }) => kind === RETRIEVAL)
      .flatMap(({ outputMasked }) => chunksOf(outputMasked))
      .map((chunk) => [chunk.chunk_id, chunk]),
  );
  const citations = Array.isArray(resolution?.citations)
    ? (resolution.citations as { chunk_id: string; doc_id: string }[]).map(
        ({ chunk_id, doc_id }) => ({ chunk_id, doc_id }),
      )
    : [];
  const draft = resolution?.draftReply ?? null;

  return {
    case_id: kase.id,
    folio: kase.folio,
    case_status: kase.status,
    category: kase.category,
    flags: kase.flags,
    review_tier: kase.reviewTier,
    run_id: run?.id ?? null,
    run_status: run?.status ?? null,
    stop_reason: run?.stopReason ?? null,
    error_code: run?.errorCode ?? null,
    model: run?.model ?? null,
    prompt_version: run?.promptVersion ?? null,
    cost_usd: Number(run?.costUsd ?? 0),
    latency_ms: run?.latencyMs ?? null,
    input_tokens: run?.inputTokens ?? 0,
    output_tokens: run?.outputTokens ?? 0,
    steps: steps.length,
    proposal: proposal ? { type: proposal.type, ...proposal.params } : null,
    draft_reply: draft,
    citations,
    abstained: resolution?.abstained ?? null,
    model_outputs: steps
      .filter(({ kind }) => kind === LLM)
      .flatMap(({ outputMasked }) => {
        const answer = modelAnswerOf(outputMasked);
        return answer ? [answer] : [];
      }),
    validations: steps
      .filter(({ kind }) => kind === VALIDATION)
      .map(({ outputMasked }) => ({
        outcome: isRecord(outputMasked) ? String(outputMasked['outcome']) : '',
        codes:
          isRecord(outputMasked) && Array.isArray(outputMasked['codes'])
            ? outputMasked['codes'].map(String)
            : [],
      })),
    tool_calls: toolSteps.map(({ name, inputMasked }) => ({
      tool: name,
      input: inputMasked,
    })),
    retrieved_docs: [
      ...new Set([...seenChunks.values()].map(({ doc_id }) => doc_id)),
    ],
    executions: executed?.count ?? 0,
    judge_input: {
      draft_reply: draft ?? '',
      cited_chunks: citations.flatMap(({ chunk_id }) => {
        const chunk = seenChunks.get(chunk_id);
        return chunk
          ? [
              {
                doc_id: chunk.doc_id,
                section: chunk.section,
                text: chunk.content,
              },
            ]
          : [];
      }),
      tool_outputs: toolSteps.map(({ name, outputMasked }) => ({
        tool: name,
        output: outputMasked,
      })),
    },
  };
}

/**
 * One eval attempt through the real harness (03 §Runner): opens an eval
 * case through the intake, claims it by id, runs one `runCase` attempt with
 * `deps`, and reads back what was persisted.
 */
export async function runEvalCase(
  deps: RunCaseDeps,
  input: { customerId: string; text: string; receivedAt: Date },
): Promise<EvalRun> {
  const opened = await openEvalCase(deps.db, input);
  const claim = await claimCase(deps.db, opened.case_id, {
    now: new Date(deps.clock()),
    runTimeoutMs: deps.config.runTimeoutMs,
  });
  if (!claim)
    throw new Error(`eval case ${opened.case_id} could not be claimed`);
  await runCase(deps, claim);
  return readEvalRun(deps.db, opened.case_id);
}
