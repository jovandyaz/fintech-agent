import { createHash } from 'node:crypto';

import {
  maskJson,
  maskPii,
  newFolio,
  newRegistryId,
  type CaseSource,
  type WebhookEvent,
} from '@fintech-agent/contracts';
import { eq } from 'drizzle-orm';

import { isUniqueViolation } from '../common/errors/unique-violation.js';
import type { Database } from '../database/index.js';
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
export interface Intake {
  outcome: IntakeOutcome;
  case_id: string;
  folio: string;
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
export async function intakeEvent(
  db: Database,
  input: {
    event: WebhookEvent;
    payloadHash: string;
    source: Extract<CaseSource, 'webhook' | 'console'>;
    opener: Opener;
    now: Date;
  },
): Promise<Intake> {
  const { event, payloadHash, source, opener, now } = input;
  return db.transaction(async (tx) => {
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
  });
}
