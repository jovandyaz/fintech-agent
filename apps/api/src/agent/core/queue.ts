import { randomUUID } from 'node:crypto';

import type { CaseStatus, RunStatus } from '@fintech-agent/contracts';
import { and, asc, eq, lt, lte, or, sql } from 'drizzle-orm';

import type { Database, DbTransaction } from '../../database/index.js';
import { agentRuns, cases, proposedActions } from '../../database/schema.js';

/** A case is tried this many times before it ends `failed` (01 §Webhook and queue). */
export const MAX_ATTEMPTS = 3;
/** The `error_code` of a run whose worker lost its lease (01 §Failure handling). */
export const LEASE_EXPIRED = 'lease_expired';
const LEASE_MARGIN_MS = 30_000;
const BACKOFF_BASE_MS = 10_000;
const BACKOFF_MAX_MS = 300_000;
const BACKOFF_JITTER = 0.2;
const QUEUED = 'queued' satisfies CaseStatus;
const INVESTIGATING = 'investigating' satisfies CaseStatus;
const FAILED = 'failed' satisfies CaseStatus;
const RUNNING = 'running' satisfies RunStatus;
const ABANDONED = 'abandoned' satisfies RunStatus;
// The case key never changes, so the lock need not block foreign-key inserts
// into its child rows, such as the MCP server's security events mid-run.
const ROW_LOCK = 'no key update';

/** A worker's hold on one attempt at a case; every write of the attempt names it. */
export interface Claim {
  caseId: string;
  claimToken: string;
  attempt: number;
}

/** The case is no longer held by this claim: another attempt replaced it. */
export class StaleClaimError extends Error {
  constructor(readonly caseId: string) {
    super(`Claim on ${caseId} is no longer current`);
  }
}

/** `min(2^attempt × 10 s, 5 min)`, then ±20 % jitter so retries spread out. */
export function backoffMs(attempt: number, random: () => number): number {
  const base = Math.min(2 ** attempt * BACKOFF_BASE_MS, BACKOFF_MAX_MS);
  return Math.round(base * (1 + BACKOFF_JITTER * (2 * random() - 1)));
}

const holdsNoCanary = sql`not exists (select 1 from ${proposedActions} where ${proposedActions.caseId} = ${cases.id} and ${proposedActions.isCanary})`;

const abandonRuns = (tx: DbTransaction, caseId: string, now: Date) =>
  tx
    .update(agentRuns)
    .set({ status: ABANDONED, errorCode: LEASE_EXPIRED, finishedAt: now })
    .where(and(eq(agentRuns.caseId, caseId), eq(agentRuns.status, RUNNING)));

const released = { claimToken: null, lockedUntil: null };

/**
 * Claims the case due longest, queued or holding an expired lease, with
 * `SKIP LOCKED` so concurrent workers never share one. The claim gets a
 * fresh `claim_token`, a lease of `runTimeoutMs` plus 30 s and one more
 * attempt; a reclaimed lease abandons the old attempt's run, and one that
 * was the last attempt fails the case instead. A case holding a canary is
 * never claimed.
 */
export async function claimNextCase(
  db: Database,
  options: { now: Date; runTimeoutMs: number },
): Promise<Claim | null> {
  const { now } = options;
  const leaseMs = options.runTimeoutMs + LEASE_MARGIN_MS;
  for (;;) {
    const outcome = await db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({
          id: cases.id,
          status: cases.status,
          attempts: cases.attempts,
        })
        .from(cases)
        .where(
          and(
            or(
              eq(cases.status, QUEUED),
              and(eq(cases.status, INVESTIGATING), lt(cases.lockedUntil, now)),
            ),
            lte(cases.nextAttemptAt, now),
            holdsNoCanary,
          ),
        )
        .orderBy(asc(cases.nextAttemptAt))
        .limit(1)
        .for(ROW_LOCK, { skipLocked: true });
      if (!candidate) return null;
      if (candidate.status === INVESTIGATING) {
        await abandonRuns(tx, candidate.id, now);
        if (candidate.attempts >= MAX_ATTEMPTS) {
          await tx
            .update(cases)
            .set({ status: FAILED, ...released })
            .where(eq(cases.id, candidate.id));
          return FAILED;
        }
      }
      const claim: Claim = {
        caseId: candidate.id,
        claimToken: randomUUID(),
        attempt: candidate.attempts + 1,
      };
      await tx
        .update(cases)
        .set({
          status: INVESTIGATING,
          claimToken: claim.claimToken,
          lockedUntil: new Date(now.getTime() + leaseMs),
          attempts: claim.attempt,
        })
        .where(eq(cases.id, candidate.id));
      return claim;
    });
    if (outcome !== FAILED) return outcome;
  }
}

/**
 * Runs `write` in a transaction that first locks the case and checks the
 * claim is still the case's current one (fencing); otherwise nothing is
 * written and `StaleClaimError` is thrown.
 */
export async function withClaim<T>(
  db: Database,
  claim: Claim,
  write: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const [held] = await tx
      .select({ id: cases.id })
      .from(cases)
      .where(
        and(
          eq(cases.id, claim.caseId),
          eq(cases.claimToken, claim.claimToken),
          eq(cases.status, INVESTIGATING),
        ),
      )
      .for(ROW_LOCK);
    if (!held) throw new StaleClaimError(claim.caseId);
    return write(tx);
  });
}

/**
 * Ends an attempt that may succeed later, inside the `withClaim` that
 * closes its run, so both commit or neither does: the case is queued again
 * after the backoff, or fails after its last attempt. The claim is released.
 */
export async function releaseForRetry(
  tx: DbTransaction,
  claim: Claim,
  options: { now: Date; random: () => number },
): Promise<typeof QUEUED | typeof FAILED> {
  if (claim.attempt >= MAX_ATTEMPTS) return failNow(tx, claim);
  const nextAttemptAt = new Date(
    options.now.getTime() + backoffMs(claim.attempt, options.random),
  );
  await tx
    .update(cases)
    .set({ status: QUEUED, ...released, nextAttemptAt })
    .where(eq(cases.id, claim.caseId));
  return QUEUED;
}

/**
 * Ends an attempt no retry can clear (no key, a spend limit, an auth error),
 * inside the `withClaim` that closes its run: the case fails now and the
 * claim is released.
 */
export async function failNow(
  tx: DbTransaction,
  claim: Claim,
): Promise<typeof FAILED> {
  await tx
    .update(cases)
    .set({ status: FAILED, ...released })
    .where(eq(cases.id, claim.caseId));
  return FAILED;
}
