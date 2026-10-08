import { randomUUID } from 'node:crypto';

import type { WebhookEvent } from '@fintech-agent/contracts';

import type { Database } from '../database/index.js';
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
 * the console hides it and no worker claims it, queued at the scenario's
 * time so policy windows count from it; the acknowledgment and the event
 * row carry that time too, which only these hidden rows do. Each call is a
 * new case: every repeat of a test case is its own attempt.
 */
export async function openEvalCase(
  db: Database,
  input: { customerId: string; text: string; receivedAt: Date },
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
    now: input.receivedAt,
  });
}
