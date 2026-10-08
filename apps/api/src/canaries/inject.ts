import {
  EVENT_ID_PREFIX,
  TICKET_ID_PREFIX,
  newIdPayload,
  type WebhookEvent,
} from '@fintech-agent/contracts';

import type { Database } from '../database/index.js';
import { canaryCases } from '../database/schema.js';
import { WEBHOOK_SENDER } from '../webhooks/delivery.js';
import { payloadHashOf, recordIntake } from '../webhooks/intake.js';
import { CANARY_TEMPLATES, type CanaryTemplate } from './templates.js';

/** When canaries arrive: the clock, the draws and the window they spread over. */
export interface InjectPacing {
  now: () => Date;
  random: () => number;
  sleep: (ms: number) => Promise<void>;
  spreadMs: number;
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const order = [...items];
  for (let last = order.length - 1; last > 0; last -= 1) {
    const pick = Math.floor(random() * (last + 1));
    [order[last], order[pick]] = [order[pick]!, order[last]!];
  }
  return order;
}

async function injectOne(
  db: Database,
  { defect, seed }: CanaryTemplate,
  now: Date,
): Promise<string> {
  const event: WebhookEvent = {
    event_id: `${EVENT_ID_PREFIX}${newIdPayload()}`,
    ticket_id: `${TICKET_ID_PREFIX}${newIdPayload()}`,
    customer_id: seed.customerId,
    text: seed.text,
    created_at: now.toISOString(),
  };
  return db.transaction(async (tx) => {
    const { case_id } = await recordIntake(tx, {
      event,
      payloadHash: payloadHashOf(Buffer.from(JSON.stringify(event))),
      source: 'webhook',
      opener: WEBHOOK_SENDER,
      now,
    });
    await tx.insert(canaryCases).values({ caseId: case_id, defect });
    return case_id;
  });
}

/**
 * Posts one canary case per template (02 G3), in shuffled order and spread
 * over `spreadMs`, through the webhook's own intake: the same folio,
 * acknowledgment and queue as a sender's case, with its `canary_cases` marker
 * in the same transaction, so the worker runs it on its script and never on
 * the provider. Returns the case ids.
 */
export async function injectCanaries(
  db: Database,
  pacing: InjectPacing,
  templates: readonly CanaryTemplate[] = CANARY_TEMPLATES,
): Promise<string[]> {
  const order = shuffled(templates, pacing.random);
  const arrivals = order
    .map(() => pacing.random() * pacing.spreadMs)
    .sort((a, b) => a - b);
  const caseIds: string[] = [];
  let waited = 0;
  for (const [index, template] of order.entries()) {
    const arrival = arrivals[index]!;
    await pacing.sleep(arrival - waited);
    waited = arrival;
    caseIds.push(await injectOne(db, template, pacing.now()));
  }
  return caseIds;
}
