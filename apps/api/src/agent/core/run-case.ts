import {
  maskPii,
  newRegistryId,
  type CaseStatus,
  type GuardOutcome,
  type SecurityEventKind,
  type StepKind,
} from '@fintech-agent/contracts';
import type { LanguageModel, Telemetry } from 'ai';
import { and, eq } from 'drizzle-orm';

import type { ApiConfig } from '../../config.js';
import type { Database } from '../../database/index.js';
import { agentRuns, cases, securityEvents } from '../../database/schema.js';
import { runAgent, type AgentBudget, type StepRecord } from './agent.js';
import { mintCaseToken } from './case-token.js';
import { corpusStateRules } from './corpus.js';
import { usageCostUsd } from './cost.js';
import {
  INTERNAL_ERROR,
  MCP_UNAVAILABLE,
  agentDisabled,
  failRun,
  persistRun,
  type PersistInput,
  type Persisted,
  type RunErrorCode,
} from './persist.js';
import { pricingOf } from './prices.js';
import { promptVersion } from './prompt.js';
import {
  PROVIDER_ERROR,
  isProviderOutage,
  providerErrorOf,
  watchProvider,
} from './provider-errors.js';
import { StaleClaimError, withClaim, type Claim } from './queue.js';
import { redactCase, type RedactionStep } from './redact.js';
import {
  searchPoliciesTool,
  toolDefinitions,
  type CaseTools,
  type Retrieval,
} from './tools.js';
import { POLICY_SEARCH_TOOL } from './validate/evidence.js';

// The redactor is one short structured call, so it may take at most a
// quarter of the attempt and never more than 20 s: the agent needs the rest.
const REDACTOR_TIMEOUT_MS = 20_000;
const REDACTOR_SHARE_OF_ATTEMPT = 0.25;
const AGENT_OFF = 'off' satisfies ApiConfig['AGENT_MODE'];
const GUARD = 'guard' satisfies StepKind;
const INJECTION_SCAN = 'injection_scan';
const MCP_CLOSE_FAILED = 'mcp_close_failed';
const CROSS_CUSTOMER_LOOKUP =
  'cross_customer_lookup' satisfies SecurityEventKind;
const END = {
  persisted: 'persisted',
  failed: 'failed',
  stale: 'stale',
} as const;
const STALE = { kind: END.stale } as const;
const RETRYABLE: ReadonlySet<RunErrorCode> = new Set([
  PROVIDER_ERROR.unavailable,
  MCP_UNAVAILABLE,
  INTERNAL_ERROR,
]);

/** The deployment settings one attempt runs under (01 §Stack, §Context policy). */
export interface RunCaseConfig {
  mode: ApiConfig['AGENT_MODE'];
  variant: ApiConfig['AGENT_VARIANT'];
  modelId: string;
  redactorModelId: string;
  runTimeoutMs: number;
  budget: AgentBudget;
  mcpUrl: string;
  mcpAudience: string;
  caseTokenKey: string;
}

/** Everything `runCase` reaches outside itself; the worker and evals supply it. */
export interface RunCaseDeps {
  db: Database;
  config: RunCaseConfig;
  /** The model for a provider id; null when no API key is configured. */
  models: ((modelId: string) => Exclude<LanguageModel, string>) | null;
  retrieval: Retrieval;
  /** The heuristic intake scan (02 G7): a signal for ops, never a block. */
  scanInjection: (text: string) => boolean;
  connectTools: (target: {
    url: string;
    token: string;
    signal: AbortSignal;
  }) => Promise<CaseTools>;
  clock: () => number;
  random: () => number;
  /** Receives events whose free text `runCase` has already masked (02 G6). */
  log: (event: Record<string, unknown>) => void;
  /** Traces the redactor and agent calls; its span processor must be wrapped in `maskingSpanProcessor`. */
  telemetry?: Telemetry;
}

/**
 * How an attempt ended: a proposal persisted, a failed run with the case
 * queued again or failed, or nothing written because another attempt holds
 * the case. `providerOutage` is what the worker's breaker counts.
 */
export type CaseEnd =
  | { kind: typeof END.persisted; runStatus: Persisted['runStatus'] }
  | {
      kind: typeof END.failed;
      errorCode: RunErrorCode;
      caseStatus: CaseStatus;
      providerOutage: boolean;
    }
  | typeof STALE;

const guardStep = (
  name: string,
  outcome: GuardOutcome,
  extra: Partial<StepRecord> = {},
): StepRecord => ({
  kind: GUARD,
  name,
  inputMasked: null,
  outputMasked: { outcome },
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  costUsd: null,
  latencyMs: null,
  providerRequestId: null,
  finishReason: null,
  ...extra,
});

function redactionRecord(step: RedactionStep, modelId: string): StepRecord {
  const { usage } = step;
  return guardStep(step.name, step.outcome, {
    outputMasked: { outcome: step.outcome, spans: step.spans },
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    cachedInputTokens: usage?.inputTokenDetails.cacheReadTokens ?? null,
    costUsd: usage ? usageCostUsd(usage, pricingOf(modelId)) : null,
    latencyMs: step.latencyMs,
  });
}

async function crossCustomerLookupSeen(
  db: Database,
  runId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: securityEvents.id })
    .from(securityEvents)
    .where(
      and(
        eq(securityEvents.runId, runId),
        eq(securityEvents.kind, CROSS_CUSTOMER_LOOKUP),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * One attempt at a claimed case (01 §Agent pipeline): the run row is
 * committed first, then Intake (kill switch, redactor, injection scan),
 * the case token and the MCP tools, the agent, and Persist. Every write is
 * fenced by the claim. A provider or MCP failure ends the run `failed` with
 * its steps and cost; a retryable one queues the case again (01 §Failure
 * handling). The MCP client is always closed, without waiting on it.
 */
export async function runCase(
  deps: RunCaseDeps,
  claim: Claim,
): Promise<CaseEnd> {
  const { db, config } = deps;
  const now = (): Date => new Date(deps.clock());
  const startedAt = now();
  const deadlineMs = startedAt.getTime() + config.runTimeoutMs;
  const runId = newRegistryId('run');
  const trace: StepRecord[] = [];

  let held: { customerId: string; textMasked: string; receivedAt: Date };
  try {
    held = await withClaim(db, claim, async (tx) => {
      const [row] = await tx
        .select({
          customerId: cases.customerId,
          textMasked: cases.textMasked,
          receivedAt: cases.receivedAt,
        })
        .from(cases)
        .where(eq(cases.id, claim.caseId));
      if (!row) throw new StaleClaimError(claim.caseId);
      await tx.insert(agentRuns).values({
        id: runId,
        caseId: claim.caseId,
        variant: config.variant,
        model: config.modelId,
        promptVersion: promptVersion(toolDefinitions(deps.retrieval.catalog)),
        startedAt,
      });
      return row;
    });
  } catch (error) {
    if (error instanceof StaleClaimError) return STALE;
    throw error;
  }

  // The console shows only text_redacted (02 G6), so a case that never
  // reaches the redactor shows its masked text.
  const storeCaseText = (text: string) =>
    withClaim(db, claim, (tx) =>
      tx
        .update(cases)
        .set({ textRedacted: text })
        .where(eq(cases.id, claim.caseId)),
    );
  const scan = (text: string): boolean => {
    const flagged = deps.scanInjection(text);
    trace.push(guardStep(INJECTION_SCAN, flagged ? 'flagged' : 'passed'));
    return flagged;
  };
  const persist = async (
    input: Pick<PersistInput, 'outcome' | 'stateRules'>,
  ): Promise<CaseEnd> => {
    const { runStatus } = await persistRun(db, {
      ...input,
      claim,
      runId,
      trace,
      now: now(),
      log: deps.log,
    });
    return { kind: END.persisted, runStatus };
  };
  const fail = async (
    errorCode: RunErrorCode,
    providerOutage = false,
  ): Promise<CaseEnd> => {
    try {
      const caseStatus = await failRun(db, {
        claim,
        runId,
        errorCode,
        retryable: RETRYABLE.has(errorCode),
        trace,
        now: now(),
        random: deps.random,
      });
      return { kind: END.failed, errorCode, caseStatus, providerOutage };
    } catch (error) {
      if (error instanceof StaleClaimError) return STALE;
      throw error;
    }
  };

  let tools: CaseTools | null = null;
  let agentModel: ReturnType<typeof watchProvider> | null = null;
  try {
    if (config.mode === AGENT_OFF) {
      await storeCaseText(held.textMasked);
      return await persist({
        outcome: agentDisabled(scan(held.textMasked)),
        stateRules: [],
      });
    }
    const { models } = deps;
    if (models === null) {
      await storeCaseText(held.textMasked);
      return await fail(PROVIDER_ERROR.noApiKey);
    }
    // A corpus that does not parse is a bug: fail before paying the redactor.
    const stateRules = await corpusStateRules(db);

    const redaction = await redactCase(held.textMasked, {
      model: models(config.redactorModelId),
      timeoutMs: Math.min(
        REDACTOR_TIMEOUT_MS,
        (deadlineMs - deps.clock()) * REDACTOR_SHARE_OF_ATTEMPT,
      ),
      telemetry: deps.telemetry,
    });
    if (redaction.step) {
      trace.push(redactionRecord(redaction.step, config.redactorModelId));
    }
    await storeCaseText(redaction.text);
    const injectionSignal = scan(redaction.text);

    // Minted from the attempt start, so the token cannot outlive the attempt
    // by more than its margin however long the redactor took (02 G4).
    const token = await mintCaseToken({
      key: config.caseTokenKey,
      audience: config.mcpAudience,
      customerId: held.customerId,
      caseId: claim.caseId,
      runId,
      now: startedAt,
      runTimeoutMs: config.runTimeoutMs,
    });
    try {
      tools = await deps.connectTools({
        url: config.mcpUrl,
        token,
        signal: AbortSignal.timeout(Math.max(0, deadlineMs - deps.clock())),
      });
    } catch (error) {
      deps.log({ event: MCP_UNAVAILABLE, error: maskPii(String(error)) });
      return await fail(MCP_UNAVAILABLE);
    }

    agentModel = watchProvider(models(config.modelId));
    const outcome = await runAgent({
      model: agentModel.model,
      modelId: config.modelId,
      tools: {
        ...tools.tools,
        [POLICY_SEARCH_TOOL]: searchPoliciesTool(deps.retrieval),
      },
      caseText: redaction.text,
      stateRules,
      receivedAt: held.receivedAt,
      injectionSignal,
      crossCustomerLookup: () => crossCustomerLookupSeen(db, runId),
      budget: config.budget,
      deadlineMs,
      clock: deps.clock,
      log: deps.log,
      trace,
      telemetry: deps.telemetry,
    });
    return await persist({ outcome, stateRules });
  } catch (error) {
    if (error instanceof StaleClaimError) return STALE;
    const cause = agentModel?.causeOf(error) ?? error;
    const code = providerErrorOf(cause);
    if (code === null) {
      deps.log({ event: INTERNAL_ERROR, error: maskPii(String(error)) });
    }
    return await fail(code ?? INTERNAL_ERROR, isProviderOutage(cause));
  } finally {
    // Closing sends a request with no deadline; a hung MCP server must not
    // hold the worker after the attempt is already written.
    void tools?.close().catch((error: unknown) => {
      deps.log({ event: MCP_CLOSE_FAILED, error: maskPii(String(error)) });
    });
  }
}
