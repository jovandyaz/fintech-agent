import { createHmac, timingSafeEqual } from 'node:crypto';

/** The Standard Webhooks v1 header names a sender sets and the verifier reads. */
export const WEBHOOK_HEADERS = {
  id: 'webhook-id',
  timestamp: 'webhook-timestamp',
  signature: 'webhook-signature',
} as const;

/** How far a signed timestamp may sit from now, either way (Stripe's default). */
export const WEBHOOK_TOLERANCE_S = 300;

const VERDICT = {
  valid: 'valid',
  missingHeaders: 'missing_headers',
  stale: 'stale_timestamp',
  bad: 'bad_signature',
} as const;

/** Why a request is refused, or `valid`. */
export type WebhookVerdict = (typeof VERDICT)[keyof typeof VERDICT];

const SECRET_PREFIX = 'whsec_';
const SIGNATURE_VERSION = 'v1';
const BASE64 = 'base64';
const WHOLE_SECONDS = /^\d+$/;
const STRICT_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
// Standard Webhooks keys run 24 to 64 bytes; a shorter one is a typo or a weak key.
const MIN_SECRET_BYTES = 24;

/**
 * The secrets in `WEBHOOK_SECRET`: each `whsec_` followed by the base64 key,
 * several separated by spaces while one rotates out; the first is the one a
 * sender signs with. Throws on any other shape, so a typo stops boot instead
 * of refusing every webhook.
 */
export function parseWebhookSecrets(raw: string): [Buffer, ...Buffer[]] {
  const [first, ...rest] = raw.trim().split(/\s+/).filter(Boolean);
  if (first === undefined) throw new Error('WEBHOOK_SECRET holds no secret');
  return [keyOf(first), ...rest.map(keyOf)];
}

function keyOf(secret: string): Buffer {
  const key = secret.startsWith(SECRET_PREFIX)
    ? Buffer.from(secret.slice(SECRET_PREFIX.length), BASE64)
    : Buffer.alloc(0);
  if (key.length < MIN_SECRET_BYTES) {
    throw new Error(
      `each WEBHOOK_SECRET must be ${SECRET_PREFIX}<base64 of at least ${MIN_SECRET_BYTES} bytes>`,
    );
  }
  return key;
}

const digestOf = (
  secret: Buffer,
  id: string,
  timestamp: string,
  body: Buffer,
): Buffer =>
  createHmac('sha256', secret)
    .update(`${id}.${timestamp}.`)
    .update(body)
    .digest();

/** The `webhook-signature` value for one secret. */
export function signWebhook(input: {
  id: string;
  timestamp: number;
  body: string;
  secret: Buffer;
}): string {
  const digest = digestOf(
    input.secret,
    input.id,
    String(input.timestamp),
    Buffer.from(input.body),
  );
  return `${SIGNATURE_VERSION},${digest.toString(BASE64)}`;
}

/**
 * Checks a request against every configured secret on its raw bytes: any one
 * `v1` signature in the space-separated header that matches makes it valid,
 * so a sender can sign with the old and the new secret during a rotation.
 */
export function verifyWebhook(input: {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  body: Buffer;
  secrets: readonly Buffer[];
  nowS: number;
}): WebhookVerdict {
  const { id, timestamp, signature } = input;
  if (!id || !timestamp || !signature) return VERDICT.missingHeaders;
  if (!WHOLE_SECONDS.test(timestamp)) return VERDICT.bad;
  if (Math.abs(input.nowS - Number(timestamp)) > WEBHOOK_TOLERANCE_S) {
    return VERDICT.stale;
  }
  const expected = input.secrets.map((secret) =>
    digestOf(secret, id, timestamp, input.body),
  );
  const offered = signature
    .split(' ')
    .map((entry) => entry.split(','))
    .filter(
      ([version, value]) =>
        version === SIGNATURE_VERSION && STRICT_BASE64.test(value ?? ''),
    )
    .map(([, value]) => Buffer.from(value ?? '', BASE64));
  const matches = offered.some((candidate) =>
    expected.some(
      (digest) =>
        candidate.length === digest.length &&
        timingSafeEqual(candidate, digest),
    ),
  );
  return matches ? VERDICT.valid : VERDICT.bad;
}
