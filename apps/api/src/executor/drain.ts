import {
  CoreUnavailableError,
  maskJson,
  type ActionParams,
  type ActionStatus,
  type CoreClient,
  type Transaction,
  type WritableAction,
} from '@fintech-agent/contracts';
import { and, asc, eq, lt, ne, notExists, sql } from 'drizzle-orm';

import { transition } from '../approvals/transition.js';
import { isUniqueViolation } from '../common/errors/unique-violation.js';
import type { Database } from '../database/index.js';
import {
  actionExecutions,
  auditLog,
  cases,
  proposedActions,
} from '../database/schema.js';
import type { CoreWriteClient } from './core-write-client.js';
import { revalidate } from './revalidate.js';

/** How long a `started` execution waits before the sweeper retries it, per attempt (02 G3). */
export const SWEEP_AFTER_MS = 120_000;
/** Attempts before an execution that never got an answer is marked `failed`. */
export const MAX_EXECUTION_ATTEMPTS = 5;

const ACTOR = 'executor';
const APPROVED: ActionStatus = 'approved';
const NO_EFFECT = 'none';
const EXECUTION_UNIQUE = 'action_executions_pkey';
const EXECUTION_STATUS = {
  started: 'started',
  executed: 'executed',
  failed: 'failed',
} as const;

export interface ExecutorDeps {
  db: Database;
  core: Pick<CoreClient, 'transaction'>;
  writer: CoreWriteClient;
  now: () => Date;
}

/** An approved action this process holds an execution row for. */
export interface ClaimedAction {
  actionId: string;
  type: WritableAction;
  params: ActionParams;
  customerId: string;
}

type Ending =
  | {
      status: typeof EXECUTION_STATUS.executed;
      detail: Record<string, unknown>;
    }
  | { status: typeof EXECUTION_STATUS.failed; detail: { reason: string } };

const failure = (reason: string): Ending => ({
  status: EXECUTION_STATUS.failed,
  detail: { reason },
});

/**
 * Claims the oldest approved, non-canary action with an effect and no
 * execution yet: `FOR UPDATE SKIP LOCKED`, then an `action_executions` row in
 * `started` in the same transaction. A concurrent claimer loses on the unique
 * key and gets null, never an error.
 */
export async function claimNext(
  deps: Pick<ExecutorDeps, 'db' | 'now'>,
): Promise<ClaimedAction | null> {
  try {
    return await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          actionId: proposedActions.id,
          type: proposedActions.type,
          params: proposedActions.params,
          customerId: cases.customerId,
        })
        .from(proposedActions)
        .innerJoin(cases, eq(cases.id, proposedActions.caseId))
        .where(
          and(
            eq(proposedActions.status, APPROVED),
            eq(proposedActions.isCanary, false),
            ne(proposedActions.type, NO_EFFECT),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(actionExecutions)
                .where(eq(actionExecutions.actionId, proposedActions.id)),
            ),
          ),
        )
        .orderBy(asc(proposedActions.decidedAt))
        .limit(1)
        .for('update', { of: proposedActions, skipLocked: true });
      if (!row || row.type === NO_EFFECT) return null;
      await tx.insert(actionExecutions).values({
        actionId: row.actionId,
        status: EXECUTION_STATUS.started,
        startedAt: deps.now(),
      });
      return { ...row, type: row.type };
    });
  } catch (error) {
    if (isUniqueViolation(error, EXECUTION_UNIQUE)) return null;
    throw error;
  }
}

async function finish(
  deps: ExecutorDeps,
  actionId: string,
  ending: Ending,
): Promise<void> {
  const status = transition(
    APPROVED,
    ending.status === EXECUTION_STATUS.executed ? 'execute' : 'fail',
    false,
  );
  if (!status) return;
  await deps.db.transaction(async (tx) => {
    const finished = await tx
      .update(actionExecutions)
      .set({
        status: ending.status,
        finishedAt: deps.now(),
        result: maskJson(ending.detail),
      })
      .where(
        and(
          eq(actionExecutions.actionId, actionId),
          eq(actionExecutions.status, EXECUTION_STATUS.started),
        ),
      )
      .returning({ actionId: actionExecutions.actionId });
    if (finished.length === 0) return;
    await tx
      .update(proposedActions)
      .set({ status })
      .where(
        and(
          eq(proposedActions.id, actionId),
          eq(proposedActions.status, APPROVED),
        ),
      );
    await tx.insert(auditLog).values({
      at: deps.now(),
      actor: ACTOR,
      event: `execution.${ending.status}`,
      ref: actionId,
      detailMasked: maskJson(ending.detail),
    });
  });
}

async function readTransactions(
  deps: ExecutorDeps,
  ids: readonly string[],
): Promise<(Transaction | null)[] | null> {
  try {
    return await Promise.all(ids.map((id) => deps.core.transaction(id)));
  } catch (error) {
    if (error instanceof CoreUnavailableError) return null;
    throw error;
  }
}

/**
 * Re-validates a claimed action on fresh core data and writes its effect
 * with `Idempotency-Key: <action_id>` (02 G3). A failed re-validation or a
 * refusal ends it `failed` without (another) write; an unreachable core
 * leaves it `started` for `sweep`.
 */
export async function executeClaimed(
  deps: ExecutorDeps,
  claimed: ClaimedAction,
): Promise<void> {
  const { actionId, type, params, customerId } = claimed;
  const transactions = await readTransactions(deps, params.transaction_ids);
  if (!transactions) return;
  const invalid = revalidate(
    { type, transaction_ids: params.transaction_ids },
    customerId,
    transactions,
    deps.now(),
  );
  if (invalid) {
    await finish(deps, actionId, failure(invalid));
    return;
  }
  let outcome;
  try {
    outcome = await deps.writer.write(
      type,
      {
        action_id: actionId,
        customer_id: customerId,
        transaction_ids: params.transaction_ids,
        reason_code: params.reason_code,
      },
      actionId,
    );
  } catch (error) {
    if (error instanceof CoreUnavailableError) return;
    throw error;
  }
  await finish(
    deps,
    actionId,
    outcome.outcome === 'accepted'
      ? { status: EXECUTION_STATUS.executed, detail: { ...outcome.result } }
      : failure(outcome.reason),
  );
}

/**
 * Retries every `started` execution older than `attempts × SWEEP_AFTER_MS`
 * with the same key, so a crash between the claim and the answer neither
 * loses the action nor repeats its effect; core-mock returns the first result.
 * After `MAX_EXECUTION_ATTEMPTS` the execution fails.
 */
export async function sweep(deps: ExecutorDeps): Promise<void> {
  const now = deps.now().getTime();
  const stale = await deps.db
    .select({
      actionId: actionExecutions.actionId,
      attempts: actionExecutions.attempts,
      startedAt: actionExecutions.startedAt,
      type: proposedActions.type,
      params: proposedActions.params,
      customerId: cases.customerId,
    })
    .from(actionExecutions)
    .innerJoin(
      proposedActions,
      eq(proposedActions.id, actionExecutions.actionId),
    )
    .innerJoin(cases, eq(cases.id, proposedActions.caseId))
    .where(
      and(
        eq(actionExecutions.status, EXECUTION_STATUS.started),
        lt(actionExecutions.startedAt, new Date(now - SWEEP_AFTER_MS)),
      ),
    );
  for (const row of stale) {
    if (row.startedAt.getTime() > now - row.attempts * SWEEP_AFTER_MS) continue;
    if (row.attempts >= MAX_EXECUTION_ATTEMPTS) {
      await finish(deps, row.actionId, failure('attempts_exhausted'));
      continue;
    }
    if (row.type === NO_EFFECT) continue;
    const bumped = await deps.db
      .update(actionExecutions)
      .set({ attempts: row.attempts + 1 })
      .where(
        and(
          eq(actionExecutions.actionId, row.actionId),
          eq(actionExecutions.attempts, row.attempts),
          eq(actionExecutions.status, EXECUTION_STATUS.started),
        ),
      )
      .returning({ actionId: actionExecutions.actionId });
    if (bumped.length === 0) continue;
    await executeClaimed(deps, {
      actionId: row.actionId,
      type: row.type,
      params: row.params,
      customerId: row.customerId,
    });
  }
}
