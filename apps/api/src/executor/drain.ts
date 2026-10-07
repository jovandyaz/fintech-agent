import {
  ActionParamsSchema,
  CoreUnavailableError,
  isWritableAction,
  maskJson,
  readTransactions,
  type ActionParams,
  type ActionStatus,
  type CoreReader,
  type CoreWriteRefusal,
  type CoreWriteResult,
  type ExecutionStatus,
  type Transaction,
  type WritableAction,
} from '@fintech-agent/contracts';
import { and, asc, eq, ne, notExists, sql } from 'drizzle-orm';

import { transition } from '../approvals/transition.js';
import { isUniqueViolation } from '../common/errors/unique-violation.js';
import type { Database } from '../database/index.js';
import {
  actionExecutions,
  auditLog,
  cases,
  proposedActions,
} from '../database/schema.js';
import type { CoreWriteClient, WriteOutcome } from './core-write-client.js';
import { revalidate, type RevalidationFailure } from './revalidate.js';

/** How long a `started` execution waits after its last attempt before the sweeper retries it (02 G3). */
export const SWEEP_AFTER_MS = 120_000;
/** Attempts before an execution whose outcome core cannot confirm is marked `failed`. */
export const MAX_EXECUTION_ATTEMPTS = 5;

const ACTOR = 'executor';
const APPROVED: ActionStatus = 'approved';
const NO_EFFECT = 'none';
const EXECUTION_UNIQUE = 'action_executions_pkey';
const INVALID_PARAMS = 'invalid_params';
const ATTEMPTS_EXHAUSTED = 'attempts_exhausted';
const EXECUTION_STATUS = {
  started: 'started',
  executed: 'executed',
  failed: 'failed',
} as const satisfies Record<ExecutionStatus, ExecutionStatus>;

type ExecutionFailure =
  | RevalidationFailure
  | CoreWriteRefusal
  | typeof INVALID_PARAMS
  | typeof ATTEMPTS_EXHAUSTED;

export interface ExecutorDeps {
  db: Database;
  core: CoreReader;
  writer: CoreWriteClient;
  now: () => Date;
  /** Core could not answer; the execution stays `started` for the sweeper. */
  onDeferred?: (actionId: string, reason: string) => void;
  /** An execution ended, after its ending was committed. */
  onFinished?: (ending: {
    actionId: string;
    status: ExecutionStatus;
    reason?: string;
  }) => void;
}

/** An approved action this process holds an execution row for. */
export interface ClaimedAction {
  actionId: string;
  type: WritableAction;
  params: unknown;
  customerId: string;
}

/** Another executor took the action between this one's read and its insert. */
export const LOST_CLAIM = 'lost';

type Ending =
  | {
      status: typeof EXECUTION_STATUS.executed;
      detail: CoreWriteResult;
    }
  | {
      status: typeof EXECUTION_STATUS.failed;
      detail: { reason: ExecutionFailure; last?: string };
    };

const failure = (reason: ExecutionFailure, last?: string): Ending => ({
  status: EXECUTION_STATUS.failed,
  detail: last === undefined ? { reason } : { reason, last },
});

/**
 * Claims the oldest approved, non-canary action with an effect and no
 * execution yet: `FOR UPDATE SKIP LOCKED`, then an `action_executions` row in
 * `started` in the same transaction. Null when nothing waits; `LOST_CLAIM`
 * when a concurrent claimer won the unique key, so the caller keeps draining.
 */
export async function claimNext(
  deps: Pick<ExecutorDeps, 'db' | 'now'>,
): Promise<ClaimedAction | typeof LOST_CLAIM | null> {
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
      if (!row || !isWritableAction(row.type)) return null;
      const now = deps.now();
      await tx.insert(actionExecutions).values({
        actionId: row.actionId,
        status: EXECUTION_STATUS.started,
        startedAt: now,
        lastAttemptAt: now,
      });
      return { ...row, type: row.type };
    });
  } catch (error) {
    if (isUniqueViolation(error, EXECUTION_UNIQUE)) return LOST_CLAIM;
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
  if (!status) throw new Error(`no transition ends ${actionId}`);
  let ended = false;
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
    const moved = await tx
      .update(proposedActions)
      .set({ status })
      .where(
        and(
          eq(proposedActions.id, actionId),
          eq(proposedActions.status, APPROVED),
        ),
      )
      .returning({ id: proposedActions.id });
    // An execution row only exists for an approved action, so this rolls back
    // a state the database should never hold rather than record a half ending.
    if (moved.length === 0)
      throw new Error(`${actionId} is no longer approved`);
    await tx.insert(auditLog).values({
      at: deps.now(),
      actor: ACTOR,
      event: `execution.${ending.status}`,
      ref: actionId,
      detailMasked: maskJson(ending.detail),
    });
    ended = true;
  });
  if (ended) {
    deps.onFinished?.({
      actionId,
      status: ending.status,
      ...(ending.status === EXECUTION_STATUS.failed
        ? { reason: ending.detail.reason }
        : {}),
    });
  }
}

async function defer(
  deps: ExecutorDeps,
  actionId: string,
  error: CoreUnavailableError,
): Promise<void> {
  deps.onDeferred?.(actionId, error.message);
  await deps.db
    .update(actionExecutions)
    .set({ result: maskJson({ deferred: error.message }) })
    .where(
      and(
        eq(actionExecutions.actionId, actionId),
        eq(actionExecutions.status, EXECUTION_STATUS.started),
      ),
    );
}

const DEFERRED = Symbol('deferred');

async function attempt<T>(
  deps: ExecutorDeps,
  actionId: string,
  call: () => Promise<T>,
): Promise<T | typeof DEFERRED> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof CoreUnavailableError)) throw error;
    await defer(deps, actionId, error);
    return DEFERRED;
  }
}

/**
 * Re-validates a claimed action on fresh core data and writes its effect
 * with `Idempotency-Key: <action_id>` (02 G2, G3). Params that are not the
 * closed G2 shape, a failed re-validation or a refusal end it `failed`
 * without a write; an unreachable core leaves it `started` for `sweep`.
 */
export async function executeClaimed(
  deps: ExecutorDeps,
  claimed: ClaimedAction,
): Promise<void> {
  const { actionId, type, customerId } = claimed;
  const parsed = ActionParamsSchema.safeParse(claimed.params);
  if (!parsed.success) {
    await finish(deps, actionId, failure(INVALID_PARAMS));
    return;
  }
  const params: ActionParams = parsed.data;
  const transactions: (Transaction | null)[] | typeof DEFERRED = await attempt(
    deps,
    actionId,
    () => readTransactions(deps.core, params.transaction_ids),
  );
  if (transactions === DEFERRED) return;
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
  const outcome: WriteOutcome | typeof DEFERRED = await attempt(
    deps,
    actionId,
    () =>
      deps.writer.write(
        type,
        {
          action_id: actionId,
          customer_id: customerId,
          transaction_ids: params.transaction_ids,
          reason_code: params.reason_code,
        },
        actionId,
      ),
  );
  if (outcome === DEFERRED) return;
  await finish(
    deps,
    actionId,
    outcome.outcome === 'accepted'
      ? { status: EXECUTION_STATUS.executed, detail: outcome.result }
      : failure(outcome.reason),
  );
}

interface StaleExecution {
  actionId: string;
  attempts: number;
  result: unknown;
  type: string;
  params: unknown;
  customerId: string;
}

const lastDeferral = (result: unknown): string | undefined => {
  const deferred = (result as { deferred?: unknown } | null)?.deferred;
  return typeof deferred === 'string' ? deferred : undefined;
};

async function retry(deps: ExecutorDeps, row: StaleExecution): Promise<void> {
  const bumped = await deps.db
    .update(actionExecutions)
    .set({ attempts: row.attempts + 1, lastAttemptAt: deps.now() })
    .where(
      and(
        eq(actionExecutions.actionId, row.actionId),
        eq(actionExecutions.attempts, row.attempts),
        eq(actionExecutions.status, EXECUTION_STATUS.started),
      ),
    )
    .returning({ attempts: actionExecutions.attempts });
  if (bumped.length === 0) return;
  // A lost answer may hide a landed effect: ask core before anything else, so
  // neither a re-validation on changed data nor exhaustion overrides it.
  const landed = await attempt(deps, row.actionId, () =>
    deps.writer.effectOf(row.actionId),
  );
  if (landed === DEFERRED) return;
  if (landed) {
    await finish(deps, row.actionId, {
      status: EXECUTION_STATUS.executed,
      detail: landed,
    });
    return;
  }
  if (!isWritableAction(row.type)) {
    await finish(deps, row.actionId, failure(INVALID_PARAMS));
    return;
  }
  await executeClaimed(deps, { ...row, type: row.type });
}

// Exhausting is only safe once core says no effect landed; while it cannot
// answer the outcome is unknown, and the row stays `started` for a later sweep.
async function exhaust(deps: ExecutorDeps, row: StaleExecution): Promise<void> {
  const marked = await deps.db
    .update(actionExecutions)
    .set({ lastAttemptAt: deps.now() })
    .where(
      and(
        eq(actionExecutions.actionId, row.actionId),
        eq(actionExecutions.status, EXECUTION_STATUS.started),
      ),
    )
    .returning({ actionId: actionExecutions.actionId });
  if (marked.length === 0) return;
  const landed = await attempt(deps, row.actionId, () =>
    deps.writer.effectOf(row.actionId),
  );
  if (landed === DEFERRED) return;
  await finish(
    deps,
    row.actionId,
    landed
      ? { status: EXECUTION_STATUS.executed, detail: landed }
      : failure(ATTEMPTS_EXHAUSTED, lastDeferral(row.result)),
  );
}

/**
 * Retries every `started` execution whose last attempt is older than
 * `SWEEP_AFTER_MS`, with the same key: it first asks core whether the effect
 * landed, so a crash or a lost answer neither loses the action nor repeats
 * it. After `MAX_EXECUTION_ATTEMPTS` it fails, naming the last reason it was
 * deferred, but only once core confirms no effect landed. One row's error is reported and the rest still run.
 */
export async function sweep(
  deps: ExecutorDeps,
  options: { signal?: AbortSignal; onError?: (error: unknown) => void } = {},
): Promise<void> {
  const due = new Date(deps.now().getTime() - SWEEP_AFTER_MS);
  const stale = await deps.db
    .select({
      actionId: actionExecutions.actionId,
      attempts: actionExecutions.attempts,
      result: actionExecutions.result,
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
        sql`coalesce(${actionExecutions.lastAttemptAt}, ${actionExecutions.startedAt}) < ${due.toISOString()}`,
      ),
    );
  for (const row of stale) {
    if (options.signal?.aborted) return;
    try {
      if (row.attempts >= MAX_EXECUTION_ATTEMPTS) {
        await exhaust(deps, row);
      } else {
        await retry(deps, row);
      }
    } catch (error) {
      options.onError?.(error);
    }
  }
}
