import {
  maskPii,
  newFolio,
  newIdPayload,
  newRegistryId,
} from '@fintech-agent/contracts';
import { desc, eq } from 'drizzle-orm';

import type { Database } from '../database/index.js';
import {
  agentRuns,
  cases,
  proposedActions,
  resolutions,
} from '../database/schema.js';
import { CANARY_TEMPLATES, type CanaryTemplate } from './templates.js';

const TICKET_PREFIX = 'tkt-';

/**
 * Seeds one canary proposal per template (02 G3): its own case, run and
 * resolution, as `copilot_api`, indistinguishable from a real proposal but
 * for `is_canary`. The run copies the identity, tokens, cost and latency of
 * the latest succeeded run; with none to mirror it refuses, since a canary
 * that looks unlike real work would be spotted. Returns the action ids.
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

  const actionIds: string[] = [];
  for (const { seed } of templates) {
    const now = deps.now();
    const caseId = newRegistryId('case');
    const runId = newRegistryId('run');
    const actionId = newRegistryId('act');
    const params = {
      transaction_ids: seed.action.transaction_ids,
      reason_code: seed.action.reason_code,
    };
    await db.transaction(async (tx) => {
      await tx.insert(cases).values({
        id: caseId,
        ticketId: `${TICKET_PREFIX}${newIdPayload()}`,
        folio: newFolio(),
        receivedAt: now,
        source: 'webhook',
        customerId: seed.customerId,
        textMasked: maskPii(seed.text),
        status: 'needs_review',
        category: seed.category,
        flags: [],
        reviewTier: 'standard',
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
        startedAt: now,
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
      });
    });
    actionIds.push(actionId);
  }
  return actionIds;
}
