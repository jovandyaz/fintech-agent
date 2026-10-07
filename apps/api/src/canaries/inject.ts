import {
  maskPii,
  newFolio,
  newIdPayload,
  newRegistryId,
  TICKET_ID_PREFIX,
} from '@fintech-agent/contracts';
import { desc, eq } from 'drizzle-orm';

import { proposalAudit } from '../cases/proposal-audit.js';
import { reviewTierOf } from '../cases/review-tier.js';
import type { Database, DbTransaction } from '../database/index.js';
import {
  agentRuns,
  auditLog,
  cases,
  proposedActions,
  resolutions,
} from '../database/schema.js';
import { CANARY_TEMPLATES, type CanaryTemplate } from './templates.js';

// A real case waits in the queue before its run starts.
const QUEUE_WAIT_MS = 4_000;

/**
 * Seeds one canary proposal per template (02 G3): its own case, run and
 * resolution, all in one transaction, as `copilot_api`, indistinguishable
 * from a real proposal but for `is_canary`. Cases get Persist's flags and
 * tier; runs copy the identity, tokens, cost and latency of the latest
 * succeeded run, with timestamps to match. With no run to mirror it refuses,
 * since a canary that looks unlike real work would be spotted. Returns the
 * action ids.
 */
export async function injectCanaries(
  db: Database,
  deps: { now: () => Date },
  templates: readonly CanaryTemplate[] = CANARY_TEMPLATES,
): Promise<string[]> {
  const [mirror] = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.status, 'succeeded'))
    .orderBy(desc(agentRuns.startedAt))
    .limit(1);
  if (!mirror)
    throw new Error('no succeeded run to mirror; run a real case first');

  const latencyMs = mirror.latencyMs ?? 0;
  return db.transaction(async (tx) => {
    const actionIds: string[] = [];
    for (const { seed } of templates) {
      const now = deps.now();
      const startedAt = new Date(now.getTime() - latencyMs);
      const caseId = newRegistryId('case');
      const runId = newRegistryId('run');
      const actionId = newRegistryId('act');
      const params = {
        transaction_ids: seed.action.transaction_ids,
        reason_code: seed.action.reason_code,
      };
      const reviewTier = reviewTierOf(seed.action.type, seed.flags);
      await tx.insert(cases).values({
        id: caseId,
        ticketId: `${TICKET_ID_PREFIX}${newIdPayload()}`,
        folio: newFolio(),
        receivedAt: new Date(startedAt.getTime() - QUEUE_WAIT_MS),
        source: 'webhook',
        customerId: seed.customerId,
        textMasked: maskPii(seed.text),
        status: 'needs_review',
        category: seed.category,
        flags: seed.flags,
        reviewTier,
      });
      await tx.insert(agentRuns).values({
        id: runId,
        caseId,
        variant: mirror.variant,
        model: mirror.model,
        promptVersion: mirror.promptVersion,
        status: mirror.status,
        stopReason: mirror.stopReason,
        inputTokens: mirror.inputTokens,
        outputTokens: mirror.outputTokens,
        cachedInputTokens: mirror.cachedInputTokens,
        costUsd: mirror.costUsd,
        latencyMs: mirror.latencyMs,
        startedAt,
        finishedAt: now,
      });
      await tx.insert(resolutions).values({
        runId,
        category: seed.category,
        draftReply: seed.draftReply,
        citations: [],
        abstained: false,
        reasoningSummary: seed.reasoningSummary,
      });
      await tx.insert(proposedActions).values({
        id: actionId,
        caseId,
        runId,
        agentType: seed.action.type,
        agentParams: params,
        type: seed.action.type,
        params,
        justification: seed.action.justification,
        isCanary: true,
        proposedAt: now,
      });
      await tx.insert(auditLog).values(
        proposalAudit({
          at: now,
          variant: mirror.variant,
          promptVersion: mirror.promptVersion,
          actionId,
          runId,
          type: seed.action.type,
          flags: seed.flags,
          reviewTier,
        }),
      );
      actionIds.push(actionId);
    }
    return actionIds;
  });
}

/**
 * Copies an open canary into a fresh run and proposal on the same case, as a
 * real re-run would produce a new proposal, so re-running a canary neither
 * reveals it nor sends its fabricated text to the agent. Returns the new id.
 */
export async function cloneCanary(
  tx: DbTransaction,
  canary: { runId: string | null; caseId: string },
  now: Date,
): Promise<string> {
  if (!canary.runId) throw new Error('a canary always has its run');
  const [run] = await tx
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, canary.runId));
  const [resolution] = await tx
    .select()
    .from(resolutions)
    .where(eq(resolutions.runId, canary.runId));
  const [proposal] = await tx
    .select()
    .from(proposedActions)
    .where(eq(proposedActions.runId, canary.runId));
  const [held] = await tx
    .select({ flags: cases.flags, reviewTier: cases.reviewTier })
    .from(cases)
    .where(eq(cases.id, canary.caseId));
  if (!run || !resolution || !proposal || !held?.reviewTier) {
    throw new Error(`canary run ${canary.runId} is incomplete`);
  }
  const runId = newRegistryId('run');
  const actionId = newRegistryId('act');
  await tx.insert(agentRuns).values({
    ...run,
    id: runId,
    startedAt: new Date(now.getTime() - (run.latencyMs ?? 0)),
    finishedAt: now,
  });
  await tx.insert(resolutions).values({ ...resolution, runId });
  await tx.insert(proposedActions).values({
    id: actionId,
    caseId: canary.caseId,
    runId,
    agentType: proposal.agentType,
    agentParams: proposal.agentParams,
    type: proposal.agentType,
    params: proposal.agentParams,
    justification: proposal.justification,
    isCanary: true,
    proposedAt: now,
  });
  await tx.insert(auditLog).values(
    proposalAudit({
      at: now,
      variant: run.variant,
      promptVersion: run.promptVersion,
      actionId,
      runId,
      type: proposal.agentType,
      flags: held.flags,
      reviewTier: held.reviewTier,
    }),
  );
  return actionId;
}
