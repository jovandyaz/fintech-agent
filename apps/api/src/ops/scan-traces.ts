import type { TraceAlert } from '@fintech-agent/contracts';
import { eq, getTableName, gte, sql } from 'drizzle-orm';

import type { Database } from '../database/index.js';
import {
  agentRuns,
  auditLog,
  cases,
  proposedActions,
  resolutions,
  runSteps,
  securityEvents,
  webhookEvents,
} from '../database/schema.js';
import { isClean } from './is-clean.js';

type StoredRow = { key: string } & Record<string, unknown>;

function alertsOf(table: string, rows: readonly StoredRow[]): TraceAlert[] {
  return rows.flatMap(({ key, ...columns }) =>
    Object.entries(columns)
      .filter(([, value]) => !isClean(value))
      .map(([column]) => ({ table, column, key })),
  );
}

/**
 * The trace half of the PII sink scan (01 §Observability, 02 G6): every value
 * in a masked or stored-text column, written since `since`, that `maskPii` or
 * `maskJson` would still mask. Steps and resolutions date from their run's
 * start, a case text from its event row's host time (its `received_at` may
 * be on the dataset clock, 01 §Webhook and queue). Eval cases and canaries
 * are scanned too, since a leak is a breach whatever the case. Alerts come
 * in table order, oldest row first.
 */
export async function scanStoredText(
  db: Database,
  since: Date,
): Promise<TraceAlert[]> {
  const runSince = gte(agentRuns.startedAt, since);
  const steps = await db
    .select({
      runId: runSteps.runId,
      idx: runSteps.idx,
      input_masked: runSteps.inputMasked,
      output_masked: runSteps.outputMasked,
    })
    .from(runSteps)
    .innerJoin(agentRuns, eq(agentRuns.id, runSteps.runId))
    .where(runSince)
    .orderBy(agentRuns.startedAt, runSteps.runId, runSteps.idx);
  const audits = await db
    .select({ key: auditLog.id, detail_masked: auditLog.detailMasked })
    .from(auditLog)
    .where(gte(auditLog.at, since))
    .orderBy(auditLog.at, auditLog.id);
  const arrivedAt = sql<Date>`coalesce(${webhookEvents.receivedAt}, ${cases.receivedAt})`;
  const caseTexts = await db
    .select({
      key: cases.id,
      text_masked: cases.textMasked,
      text_redacted: cases.textRedacted,
    })
    .from(cases)
    .leftJoin(webhookEvents, eq(webhookEvents.caseId, cases.id))
    .where(gte(arrivedAt, since.toISOString()))
    .orderBy(arrivedAt, cases.id);
  const replies = await db
    .select({
      key: resolutions.runId,
      draft_reply: resolutions.draftReply,
      reasoning_summary: resolutions.reasoningSummary,
    })
    .from(resolutions)
    .innerJoin(agentRuns, eq(agentRuns.id, resolutions.runId))
    .where(runSince)
    .orderBy(agentRuns.startedAt, resolutions.runId);
  const proposals = await db
    .select({
      key: proposedActions.id,
      justification: proposedActions.justification,
      final_reply: proposedActions.finalReply,
    })
    .from(proposedActions)
    .where(gte(proposedActions.proposedAt, since))
    .orderBy(proposedActions.proposedAt, proposedActions.id);
  const events = await db
    .select({ key: securityEvents.id, ref_masked: securityEvents.refMasked })
    .from(securityEvents)
    .where(gte(securityEvents.at, since))
    .orderBy(securityEvents.at, securityEvents.id);

  return [
    ...alertsOf(
      getTableName(runSteps),
      steps.map(({ runId, idx, ...columns }) => ({
        key: `${runId}:${idx}`,
        ...columns,
      })),
    ),
    ...alertsOf(getTableName(auditLog), audits),
    ...alertsOf(getTableName(cases), caseTexts),
    ...alertsOf(getTableName(resolutions), replies),
    ...alertsOf(getTableName(proposedActions), proposals),
    ...alertsOf(getTableName(securityEvents), events),
  ];
}
