import { randomUUID } from 'node:crypto';

import type { WebhookEvent } from '@fintech-agent/contracts';

import type { Database } from '../database/index.js';
import { fixedClock } from '../webhooks/case-clock.js';
import { intakeEvent, payloadHashOf, type Intake } from '../webhooks/intake.js';

const EVAL_OPENER = {
  actor: 'eval-runner',
  keyId: null,
  ip: null,
  userAgent: null,
} as const;
const EVAL_ID_PREFIX = 'eval-';

/**
 * Opens one eval case through the webhook intake (01): `source = eval`, so
 * the console hides it and no worker claims it, received at the scenario's
 * time so policy windows count from it; the acknowledgment and the event
 * row carry the host time `now`, as every other case's do, so the trace
 * scan's window covers them (02 G6). Each call is a new case: every repeat
 * of a test case is its own attempt.
 */
export async function openEvalCase(
  db: Database,
  input: { customerId: string; text: string; receivedAt: Date; now: Date },
): Promise<Intake> {
  const id = `${EVAL_ID_PREFIX}${randomUUID()}`;
  const event: WebhookEvent = {
    event_id: id,
    ticket_id: id,
    customer_id: input.customerId,
    text: input.text,
    created_at: input.receivedAt.toISOString(),
  };
  return intakeEvent(db, {
    event,
    payloadHash: payloadHashOf(Buffer.from(JSON.stringify(event))),
    source: 'eval',
    opener: EVAL_OPENER,
    now: input.now,
    clock: fixedClock(input.receivedAt),
  });
}
