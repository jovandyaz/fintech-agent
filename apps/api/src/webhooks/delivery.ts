import {
  EVENT_ID_PREFIX,
  TICKET_ID_PREFIX,
  WebhookEventSchema,
  newIdPayload,
  signWebhook,
  verifyWebhook,
  type CaseSource,
  type NewCase,
  type WebhookEvent,
} from '@fintech-agent/contracts';

import type { RequestMeta } from '../common/http/request-meta.js';
import type { Database } from '../database/index.js';
import type { Operator } from '../operators/operator-tokens.js';
import {
  intakeEvent,
  payloadHashOf,
  type Intake,
  type Opener,
} from './intake.js';

/** Who opens a webhook case: the sender, authenticated by its signature alone. */
export const WEBHOOK_SENDER: Opener = {
  actor: 'intake:webhook',
  keyId: null,
  ip: null,
  userAgent: null,
};

/** The provider of what the webhook and the console form need. */
export const WEBHOOK_DEPS = 'WEBHOOK_DEPS';

/** What a delivery needs: the database, the secrets (the first one signs), a clock. */
export interface WebhookDeps {
  db: Database;
  secrets: readonly [Buffer, ...Buffer[]];
  now: () => Date;
}

/** Why a delivery is refused before it reaches intake. */
export const DELIVERY_REFUSAL = {
  signature: 'invalid_signature',
  body: 'invalid_body',
  webhookId: 'webhook_id_mismatch',
} as const;
export type DeliveryRefusal =
  (typeof DELIVERY_REFUSAL)[keyof typeof DELIVERY_REFUSAL];

/** A delivery refused before intake, and why. */
export class DeliveryRefusedError extends Error {
  constructor(readonly refusal: DeliveryRefusal) {
    super(refusal);
    this.name = 'DeliveryRefusedError';
  }
}

/** One signed delivery as it arrived: the three Standard Webhooks headers and the raw bytes. */
export interface Delivery {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  body: Buffer;
}

const MS_PER_SECOND = 1000;
const secondsOf = (at: Date): number =>
  Math.floor(at.getTime() / MS_PER_SECOND);

/**
 * The one way a case comes in (01 §Webhook and queue): the signature is
 * checked on the raw bytes before the body is trusted, the body must be a
 * ticket event whose id is the signed `webhook-id`, and intake records it.
 * Throws `DeliveryRefusedError` or intake's `IntakeConflictError`.
 */
export async function acceptDelivery(
  deps: WebhookDeps,
  delivery: Delivery,
  opened: {
    source: Extract<CaseSource, 'webhook' | 'console'>;
    opener: Opener;
  },
): Promise<Intake> {
  const now = deps.now();
  const verdict = verifyWebhook({
    ...delivery,
    secrets: deps.secrets,
    nowS: secondsOf(now),
  });
  if (verdict !== 'valid') {
    throw new DeliveryRefusedError(DELIVERY_REFUSAL.signature);
  }
  const parsed = WebhookEventSchema.safeParse(jsonOf(delivery.body));
  if (!parsed.success) throw new DeliveryRefusedError(DELIVERY_REFUSAL.body);
  if (parsed.data.event_id !== delivery.id) {
    throw new DeliveryRefusedError(DELIVERY_REFUSAL.webhookId);
  }
  return intakeEvent(deps.db, {
    event: parsed.data,
    payloadHash: payloadHashOf(delivery.body),
    ...opened,
    now,
  });
}

/**
 * A case typed into the console (01): the API builds the event and signs it
 * with the first secret, so the secret never reaches the browser, then takes
 * the webhook's own path with the operator, their token key, address and
 * user agent as the one who opened it.
 */
export async function openConsoleCase(
  deps: WebhookDeps,
  input: { form: NewCase; operator: Operator; meta: RequestMeta },
): Promise<Intake> {
  const now = deps.now();
  const event: WebhookEvent = {
    event_id: `${EVENT_ID_PREFIX}${newIdPayload()}`,
    ticket_id: `${TICKET_ID_PREFIX}${newIdPayload()}`,
    customer_id: input.form.customer_id,
    text: input.form.text,
    created_at: now.toISOString(),
  };
  const body = JSON.stringify(event);
  const timestamp = secondsOf(now);
  const [secret] = deps.secrets;
  return acceptDelivery(
    deps,
    {
      id: event.event_id,
      timestamp: String(timestamp),
      signature: signWebhook({ id: event.event_id, timestamp, body, secret }),
      body: Buffer.from(body),
    },
    {
      source: 'console',
      opener: {
        actor: input.operator.actor,
        keyId: input.operator.keyId,
        ...input.meta,
      },
    },
  );
}

// TextDecoder drops a leading byte order mark, as the JSON body parser did.
function jsonOf(body: Buffer): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return undefined;
  }
}
