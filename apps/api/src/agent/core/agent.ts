import {
  MCP_TOOL_NAMES,
  ResolutionSchema,
  maskJson,
  maskPii,
  type McpToolError,
  type McpToolName,
  type StepKind,
  type StopReason,
  type ValidationCode,
} from '@fintech-agent/contracts';
import {
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  ToolLoopAgent,
  isStepCount,
  type LanguageModel,
  type ModelMessage,
  type StepResult,
  type Telemetry,
  type ToolSet,
} from 'ai';
import { z } from 'zod';

import { CalendarRangeError } from './calendar.js';
import {
  addUsage,
  emptyUsage,
  usageCostUsd,
  type ModelPricing,
} from './cost.js';
import { PRICED_PROMPT_TOKENS_MAX, pricingOf } from './prices.js';
import { SYSTEM_PROMPT, caseMessage } from './prompt.js';
import { telemetryOf } from './telemetry.js';
import {
  POLICY_SEARCH_TOOL,
  buildEvidence,
  type RunEvidence,
  type ToolResult,
} from './validate/evidence.js';
import {
  RepairEvidenceError,
  validateWithRepair,
  type ValidationRun,
} from './validate/repair.js';
import type { ChunkStateRules } from './validate/state-rules.js';

/** Model steps one run may take, the repair turn included (01 §Context policy). */
export const RUN_MAX_STEPS = 8;
/** A model call with less time than this left in the attempt is not made. */
export const MIN_MODEL_CALL_MS = 5_000;
const STEP_TIMEOUT_MS = 60_000;
const TOOL_TIMEOUT_MS = 10_000;
const TOOL_FAILURES_TO_STOP = 2;
const REPAIRABLE_TOOL_ERROR = 'INVALID_ARGUMENTS' satisfies McpToolError;
const REQUEST_ID_HEADER = 'request-id';
const STEP = {
  llm: 'llm',
  tool: 'tool',
  retrieval: 'retrieval',
  validation: 'validation',
} as const satisfies Record<string, StepKind>;
const STOP = {
  budget: 'budget',
  error: 'error',
} as const satisfies Record<string, StopReason>;
type AgentStop = (typeof STOP)[keyof typeof STOP];
const OUTCOME = { validated: 'validated', stopped: 'stopped' } as const;
const TURN_OUTPUT = 'output';
const VALID_RUN = 'valid' satisfies ValidationRun['kind'];
const VERDICT = { passed: 'passed', failed: 'failed' } as const;
const TOOL_PART = { result: 'tool-result', error: 'tool-error' } as const;
const VALIDATOR_ERROR = 'validator_error';
const TOOL_FAILED = 'tool_failed';

/** The per-run ceilings beyond which the run falls back (01 §Context policy). */
export interface AgentBudget {
  costUsd: number;
  inputTokens: number;
}

/** One `run_steps` row before its run id and index are assigned. */
export interface StepRecord {
  kind: StepKind;
  name: string;
  inputMasked: unknown;
  outputMasked: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  providerRequestId: string | null;
  finishReason: string | null;
}

/** Everything one attempt's agent node needs; the harness supplies it. */
export interface AgentInput {
  model: LanguageModel;
  /** The provider model id, which prices each step. */
  modelId: string;
  tools: ToolSet;
  /** `text_redacted`, or `text_masked` when the redactor degraded. */
  caseText: string;
  stateRules: readonly ChunkStateRules[];
  receivedAt: Date;
  injectionSignal: boolean;
  crossCustomerLookup: () => Promise<boolean>;
  budget: AgentBudget;
  /** When the attempt ends (epoch ms); every model call is bounded by it. */
  deadlineMs: number;
  clock: () => number;
  log: (event: Record<string, unknown>) => void;
  /**
   * Receives each step as it happens, so the caller keeps what was spent and
   * seen even when a provider error ends the run.
   */
  trace: StepRecord[];
  /** The tracing integration of this call; none records no spans. */
  telemetry?: Telemetry | undefined;
}

interface Stop {
  kind: typeof OUTCOME.stopped;
  stopReason: AgentStop;
  reason: string;
}

/**
 * `validated`: the validator ran; its run is valid or its own fallback.
 * `stopped`: the run ended before a validated answer, on budget or on an
 * error the model cannot repair; Persist proposes `none` on this evidence.
 */
export type AgentOutcome =
  | {
      kind: typeof OUTCOME.validated;
      validation: ValidationRun;
    }
  | (Stop & { evidence: RunEvidence });

/** The tokens and cost of a trace, for `agent_runs` (01 §Observability). */
export interface TraceTotals {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
}

type TurnEnd = { kind: typeof TURN_OUTPUT; output: unknown } | Stop;
type Step = StepResult<ToolSet>;

const stop = (stopReason: AgentStop, reason: string = stopReason): Stop => ({
  kind: OUTCOME.stopped,
  stopReason,
  reason,
});

class TurnStopped extends Error {
  constructor(readonly end: Stop) {
    super(end.reason);
  }
}

const CallToolResultSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  isError: z.boolean().optional(),
});

const isMcpTool = (name: string): name is McpToolName =>
  (MCP_TOOL_NAMES as readonly string[]).includes(name);

function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function mcpAnswer(output: unknown): { body: unknown; isError: boolean } {
  const parsed = CallToolResultSchema.safeParse(output);
  if (!parsed.success) return { body: undefined, isError: true };
  return {
    body: parseJson(parsed.data.content[0]?.text),
    isError: parsed.data.isError === true,
  };
}

const errorCodeOf = (body: unknown): unknown =>
  typeof body === 'object' && body !== null && 'error' in body
    ? body.error
    : undefined;

function toolResultsOf(steps: readonly Step[]): ToolResult[] {
  const results: ToolResult[] = [];
  for (const { toolName, output } of steps.flatMap((s) => s.toolResults)) {
    if (toolName === POLICY_SEARCH_TOOL) {
      results.push({ tool: toolName, output });
    } else if (isMcpTool(toolName)) {
      const answer = mcpAnswer(output);
      if (!answer.isError) {
        results.push({ tool: toolName, output: answer.body });
      }
    }
  }
  return results;
}

// Like INVALID_ARGUMENTS, a call the SDK could not parse or match is the
// model's to repair, so neither counts as the tool failing.
function failedTool(steps: readonly Step[]): McpToolName | null {
  const failures = new Map<McpToolName, number>();
  for (const step of steps) {
    const invalid = new Set(
      step.toolCalls
        .filter((call) => call.invalid === true)
        .map(({ toolCallId }) => toolCallId),
    );
    for (const part of step.content) {
      if (part.type !== TOOL_PART.result && part.type !== TOOL_PART.error) {
        continue;
      }
      if (!isMcpTool(part.toolName) || invalid.has(part.toolCallId)) continue;
      const answer =
        part.type === TOOL_PART.result ? mcpAnswer(part.output) : null;
      const failed =
        answer === null ||
        (answer.isError && errorCodeOf(answer.body) !== REPAIRABLE_TOOL_ERROR);
      if (!failed) continue;
      const count = (failures.get(part.toolName) ?? 0) + 1;
      if (count >= TOOL_FAILURES_TO_STOP) return part.toolName;
      failures.set(part.toolName, count);
    }
  }
  return null;
}

const stepCost = (step: Step, pricing: ModelPricing): number =>
  usageCostUsd(step.usage, pricing);

const UNMEASURED = {
  inputMasked: null,
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  costUsd: null,
  latencyMs: null,
  providerRequestId: null,
  finishReason: null,
} as const;

function recordsOf(
  step: Step,
  modelId: string,
  pricing: ModelPricing,
): StepRecord[] {
  const llm: StepRecord = {
    kind: STEP.llm,
    name: modelId,
    inputMasked: null,
    outputMasked: maskJson({
      text: parseJson(step.text) ?? step.text,
      tool_calls: step.toolCalls.map(
        ({ toolName, input }): { tool: string; input: unknown } => ({
          tool: toolName,
          input,
        }),
      ),
    }),
    inputTokens: step.usage.inputTokens ?? null,
    outputTokens: step.usage.outputTokens ?? null,
    cachedInputTokens: step.usage.inputTokenDetails.cacheReadTokens ?? null,
    costUsd: stepCost(step, pricing),
    latencyMs: Math.round(step.performance.responseTimeMs),
    providerRequestId: step.response.headers?.[REQUEST_ID_HEADER] ?? null,
    finishReason: step.finishReason,
  };
  const tools = step.content.flatMap((part): StepRecord[] => {
    if (part.type !== TOOL_PART.result && part.type !== TOOL_PART.error) {
      return [];
    }
    const output: unknown =
      part.type === TOOL_PART.result
        ? part.output
        : { error: String(part.error) };
    const ranMs = step.performance.toolExecutionMs[part.toolCallId];
    return [
      {
        ...UNMEASURED,
        kind: part.toolName === POLICY_SEARCH_TOOL ? STEP.retrieval : STEP.tool,
        name: maskPii(part.toolName),
        inputMasked: maskJson(part.input),
        outputMasked: maskJson(output),
        latencyMs: ranMs === undefined ? null : Math.round(ranMs),
      },
    ];
  });
  return [llm, ...tools];
}

const validationRecord = (
  outcome: (typeof VERDICT)[keyof typeof VERDICT],
  codes: readonly ValidationCode[],
): StepRecord => ({
  ...UNMEASURED,
  kind: STEP.validation,
  name: STEP.validation,
  outputMasked: { outcome, codes },
});

const repairMessage = (codes: readonly ValidationCode[]): string =>
  `Your resolution failed validation with: ${codes.join(', ')}. Correct it and answer again with the complete resolution.`;

/** Sums the tokens and cost of a trace; only model steps carry them. */
export function traceTotals(trace: readonly StepRecord[]): TraceTotals {
  return trace.reduce(
    (total, record) => ({
      inputTokens: total.inputTokens + (record.inputTokens ?? 0),
      outputTokens: total.outputTokens + (record.outputTokens ?? 0),
      cachedInputTokens:
        total.cachedInputTokens + (record.cachedInputTokens ?? 0),
      costUsd: total.costUsd + (record.costUsd ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0 },
  );
}

/**
 * Runs the agentic node of one attempt (01 §The agentic node): the tool loop
 * with structured output, the 02 G5 validation with one repair turn, and the
 * run's budget of steps, tokens, cost and time. An output the SDK refuses as
 * off-schema is validated as missing, which fails SCHEMA and is repaired. A
 * budget stop, the second failure of one MCP tool or a validator error ends
 * it `stopped`; a provider error propagates to the harness, which owns
 * retries, with the steps so far already in `trace`.
 */
export async function runAgent(input: AgentInput): Promise<AgentOutcome> {
  const pricing = pricingOf(input.modelId);
  const steps: Step[] = [];
  const messages: ModelMessage[] = [
    { role: 'user', content: caseMessage(input.caseText) },
  ];

  const costOf = (all: readonly Step[]): number =>
    all.reduce((total, step) => total + stepCost(step, pricing), 0);
  const overBudget = (all: readonly Step[]): boolean =>
    costOf(all) > input.budget.costUsd ||
    all.reduce((total, step) => addUsage(total, step.usage), emptyUsage())
      .inputTokens > input.budget.inputTokens ||
    all.some(
      (step) => (step.usage.inputTokens ?? 0) > PRICED_PROMPT_TOKENS_MAX,
    );
  const outOfTime = (): boolean =>
    input.deadlineMs - input.clock() < MIN_MODEL_CALL_MS;

  async function turn(): Promise<TurnEnd> {
    const stepsLeft = RUN_MAX_STEPS - steps.length;
    if (stepsLeft < 1 || outOfTime()) return stop(STOP.budget);
    const before = steps.length;
    const sinceStart = (current: readonly Step[]): Step[] => [
      ...steps.slice(0, before),
      ...current,
    ];
    const agent = new ToolLoopAgent({
      model: input.model,
      instructions: SYSTEM_PROMPT,
      tools: input.tools,
      output: Output.object({ schema: ResolutionSchema }),
      stopWhen: [
        isStepCount(stepsLeft),
        ({ steps: current }) => overBudget(sinceStart(current)),
        ({ steps: current }) => failedTool(sinceStart(current)) !== null,
        outOfTime,
      ],
      prepareStep: ({ stepNumber }) =>
        stepNumber === stepsLeft - 1 ? { activeTools: [] } : {},
      telemetry: telemetryOf(input.telemetry),
    });
    let output: unknown;
    try {
      const result = await agent.generate({
        messages,
        timeout: {
          totalMs: input.deadlineMs - input.clock(),
          stepMs: STEP_TIMEOUT_MS,
          toolMs: TOOL_TIMEOUT_MS,
        },
        onStepEnd: (step) => {
          input.trace.push(...recordsOf(step, input.modelId, pricing));
          steps.push(step);
        },
      });
      try {
        output = result.output;
      } catch (error) {
        if (!NoOutputGeneratedError.isInstance(error)) throw error;
      }
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error)) throw error;
    }
    messages.push(
      ...steps.slice(before).flatMap((step) => step.response.messages),
    );
    if (overBudget(steps)) return stop(STOP.budget);
    const failed = failedTool(steps);
    if (failed !== null) return stop(STOP.error, `${TOOL_FAILED}:${failed}`);
    if (output === undefined && outOfTime()) return stop(STOP.budget);
    return { kind: TURN_OUTPUT, output };
  }

  const evidenceNow = async (): Promise<RunEvidence> =>
    buildEvidence({
      toolResults: toolResultsOf(steps),
      receivedAt: input.receivedAt,
      now: new Date(input.clock()),
      injectionSignal: input.injectionSignal,
      crossCustomerLookup: await input.crossCustomerLookup(),
    });
  const stopped = async (end: Stop): Promise<AgentOutcome> => ({
    ...end,
    evidence: await evidenceNow(),
  });

  const first = await turn();
  if (first.kind === OUTCOME.stopped) return stopped(first);
  try {
    const validation = await validateWithRepair(
      first.output,
      async (codes) => {
        input.trace.push(validationRecord(VERDICT.failed, codes));
        messages.push({ role: 'user', content: repairMessage(codes) });
        const next = await turn();
        if (next.kind === OUTCOME.stopped) throw new TurnStopped(next);
        return { output: next.output, evidence: await evidenceNow() };
      },
      { evidence: await evidenceNow(), stateRules: input.stateRules },
    );
    input.trace.push(
      validation.kind === VALID_RUN
        ? validationRecord(VERDICT.passed, [])
        : validationRecord(VERDICT.failed, validation.codes),
    );
    return { kind: OUTCOME.validated, validation };
  } catch (error) {
    if (error instanceof TurnStopped) return stopped(error.end);
    if (
      error instanceof CalendarRangeError ||
      error instanceof RepairEvidenceError
    ) {
      input.log({ event: VALIDATOR_ERROR, error: maskPii(String(error)) });
      return stopped(stop(STOP.error, VALIDATOR_ERROR));
    }
    throw error;
  }
}
