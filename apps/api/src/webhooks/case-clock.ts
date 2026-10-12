import type { CaseSource } from '@fintech-agent/contracts';
import { and, eq, min, ne, sql } from 'drizzle-orm';

import { BANK_CALENDAR } from '../agent/core/calendar.js';

import type { CaseClockEnv } from '../config.js';
import type { Database, DbTransaction } from '../database/index.js';
import { caseClock, cases, webhookEvents } from '../database/schema.js';

const EVAL_SOURCE: CaseSource = 'eval';

/**
 * The `received_at` a new case gets, from the host time of its delivery
 * (01 §Webhook and queue, Case clock). Called inside the intake transaction,
 * after the event row and before the case row.
 */
export type CaseClock = (tx: DbTransaction, now: Date) => Promise<Date>;

/** The host time, as is. */
export const WALL_CLOCK: CaseClock = (_tx, now) => Promise.resolve(now);

/** A clock that receives every case at `at`: an eval case at its scenario's time. */
export const fixedClock =
  (at: Date): CaseClock =>
  () =>
    Promise.resolve(at);

/** The clock `CASE_CLOCK` names. */
export const caseClockOf = (env: CaseClockEnv): CaseClock =>
  env.CASE_CLOCK === 'dataset'
    ? datasetClock(env.CASE_CLOCK_START)
    : WALL_CLOCK;

/**
 * The synthetic data's clock: each Mexico City day, the first live case is
 * received at `start` and each later one at `start` plus the host time
 * elapsed since that first case's event row, so a stack used over several
 * days keeps the data's today. Eval cases carry their scenario's time and
 * never anchor it.
 */
export function datasetClock(start: Date): CaseClock {
  return async (tx, now) => {
    const [first] = await tx
      .select({ at: min(webhookEvents.receivedAt) })
      .from(webhookEvents)
      .innerJoin(cases, eq(cases.id, webhookEvents.caseId))
      .where(
        and(
          ne(cases.source, EVAL_SOURCE),
          sql`(${webhookEvents.receivedAt} at time zone ${BANK_CALENDAR.time_zone})::date
            = (${now.toISOString()}::timestamptz at time zone ${BANK_CALENDAR.time_zone})::date`,
        ),
      );
    const anchor =
      first?.at && first.at.getTime() < now.getTime() ? first.at : now;
    return new Date(start.getTime() + now.getTime() - anchor.getTime());
  };
}

/** No api has booted against this database, so no clock is recorded. */
export class CaseClockUnrecordedError extends Error {
  constructor() {
    super('no case clock recorded: start api first');
    this.name = 'CaseClockUnrecordedError';
  }
}

/** Records the clock api boots with, replacing the one before (02 G3). */
export async function recordCaseClock(
  db: Database,
  env: CaseClockEnv,
): Promise<void> {
  const row = { mode: env.CASE_CLOCK, start: env.CASE_CLOCK_START };
  await db
    .insert(caseClock)
    .values(row)
    .onConflictDoUpdate({
      target: caseClock.id,
      set: { ...row, recordedAt: sql`now()` },
    });
}

/**
 * The clock api last booted with, read inside each intake transaction, for an
 * intake outside api (the canary injector): its cases are received as a
 * sender's are, even when api restarts on another clock mid-injection
 * (02 G3). Throws `CaseClockUnrecordedError` when api never recorded one.
 */
export const RECORDED_CLOCK: CaseClock = async (tx, now) => {
  const [row] = await tx
    .select({ mode: caseClock.mode, start: caseClock.start })
    .from(caseClock);
  if (!row) throw new CaseClockUnrecordedError();
  return caseClockOf({ CASE_CLOCK: row.mode, CASE_CLOCK_START: row.start })(
    tx,
    now,
  );
};
