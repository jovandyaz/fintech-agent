import { createHash } from 'node:crypto';

import {
  maskJson,
  maskPii,
  newFolio,
  newRegistryId,
  type CaseAcknowledgment,
  type CaseSource,
  type WebhookEvent,
} from '@fintech-agent/contracts';
import { eq } from 'drizzle-orm';

import { isUniqueViolation } from '../common/errors/unique-violation.js';
import type { Database, DbTransaction } from '../database/index.js';
import { auditLog, cases, webhookEvents } from '../database/schema.js';

const TICKET_UNIQUE = 'cases_ticket_id_unique';
const ACKNOWLEDGED = 'case.acknowledged';

/** How a delivery was answered: a new case, or the one an earlier delivery opened. */
export type IntakeOutcome = 'created' | 'replayed';

/** Why a well-signed event is refused (409). */
export type IntakeConflict = 'event_conflict' | 'ticket_conflict';

/** A refused event; the caller answers 409 and logs it. */
export class IntakeConflictError extends Error {
  constructor(readonly conflict: IntakeConflict) {
    super(conflict);
    this.name = 'IntakeConflictError';
  }
}

/** Who opened a case, as its acknowledgment's audit row records them (02 G3). */
export interface Opener {
  actor: string;
  keyId: string | null;
  ip: string | null;
  userAgent: string | null;
}

/** What the sender gets back: the case and its folio, the acknowledgment (acuse). */
export interface Intake extends CaseAcknowledgment {
  outcome: IntakeOutcome;
}

/** The hash a repeated delivery is compared by: the bytes as sent. */
export const payloadHashOf = (rawBody: Buffer): string =>
  createHash('sha256').update(rawBody).digest('hex');

/**
 * Records one event and its case in one transaction (01 §Webhook and queue):
 * the event row first, then the queued case with its folio and only the
 * masked text (02 G6), then the acknowledgment as sent, under whoever opened
 * the case (the sender, or the operator behind the console form). A
 * repeat of the same bytes returns the case it opened; the same event id with
 * other bytes, or a new event reusing a ticket id, is refused.
 */
export function intakeEvent(db: Database, input: IntakeInput): Promise<Intake> {
  return db.transaction((tx) => recordIntake(tx, input));
}

/** One event to record, with who opened its case. */
export interface IntakeInput {
  event: WebhookEvent;
  payloadHash: string;
  source: CaseSource;
  opener: Opener;
  now: Date;
}

/**
 * `intakeEvent`'s writes inside a transaction the caller holds, for a caller
 * whose own writes must commit with the case (the canary marker, 02 G3).
 */
export async function recordIntake(
  tx: DbTransaction,
  input: IntakeInput,
): Promise<Intake> {
  const { event, payloadHash, source, opener, now } = input;
  const caseId = newRegistryId('case');
  const recorded = await tx
    .insert(webhookEvents)
    .values({
      eventId: event.event_id,
      payloadHash,
      caseId,
      receivedAt: now,
    })
    .onConflictDoNothing()
    .returning({ caseId: webhookEvents.caseId });
  if (recorded.length === 0) {
    const [earlier] = await tx
      .select({
        payloadHash: webhookEvents.payloadHash,
        caseId: cases.id,
        folio: cases.folio,
      })
      .from(webhookEvents)
      .innerJoin(cases, eq(cases.id, webhookEvents.caseId))
      .where(eq(webhookEvents.eventId, event.event_id));
    if (!earlier || earlier.payloadHash !== payloadHash) {
      throw new IntakeConflictError('event_conflict');
    }
    return {
      outcome: 'replayed',
      case_id: earlier.caseId,
      folio: earlier.folio,
    };
  }
  const folio = newFolio();
  try {
    await tx.insert(cases).values({
      id: caseId,
      ticketId: event.ticket_id,
      folio,
      receivedAt: now,
      source,
      customerId: event.customer_id,
      textMasked: maskPii(event.text),
    });
  } catch (error) {
    if (isUniqueViolation(error, TICKET_UNIQUE)) {
      throw new IntakeConflictError('ticket_conflict');
    }
    throw error;
  }
  await tx.insert(auditLog).values({
    at: now,
    ...opener,
    event: ACKNOWLEDGED,
    ref: caseId,
    detailMasked: maskJson({ folio }),
  });
  return { outcome: 'created', case_id: caseId, folio };
}
