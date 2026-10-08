import { describe, expect, it } from 'vitest';

import {
  parseWebhookSecrets,
  signWebhook,
  verifyWebhook,
} from './webhook-signature.js';

const OLD = parseWebhookSecrets(
  'whsec_b2xkLXdlYmhvb2stc2VjcmV0LWZvci10ZXN0cw==',
);
const NEW = parseWebhookSecrets(
  'whsec_bmV3LXdlYmhvb2stc2VjcmV0LWZvci10ZXN0cw==',
);
const NOW_S = 1_791_400_000;
const TOLERANCE_S = 300;
const ID = 'evt-adv-01';
const BODY = '{"event_id":"evt-adv-01","text":"hola"}';

const signed = (
  overrides: Partial<{ id: string; timestamp: number; body: string }> = {},
  secret = NEW[0]!,
) => {
  const id = overrides.id ?? ID;
  const timestamp = overrides.timestamp ?? NOW_S;
  const body = overrides.body ?? BODY;
  return {
    id,
    timestamp: String(timestamp),
    signature: signWebhook({ id, timestamp, body, secret }),
    body,
  };
};

const verify = (
  request: ReturnType<typeof signed>,
  secrets = NEW,
  nowS = NOW_S,
) =>
  verifyWebhook({ ...request, body: Buffer.from(request.body), secrets, nowS });

describe('Standard Webhooks v1 signatures (01 §Webhook and queue, 02 T7)', () => {
  it('accepts what it signed', () => {
    expect(verify(signed())).toBe('valid');
  });

  it('refuses the same JSON re-serialized: the signature covers the bytes as sent', () => {
    const request = signed();
    expect(
      verify({
        ...request,
        body: '{"event_id": "evt-adv-01", "text": "hola"}',
      }),
    ).toBe('bad_signature');
  });

  it('refuses a signature over another webhook id', () => {
    expect(verify({ ...signed(), id: 'evt-adv-02' })).toBe('bad_signature');
  });

  it.each([
    ['exactly 5 minutes old', NOW_S - TOLERANCE_S, 'valid'],
    [
      'one second past 5 minutes old',
      NOW_S - TOLERANCE_S - 1,
      'stale_timestamp',
    ],
    [
      'one second past 5 minutes ahead',
      NOW_S + TOLERANCE_S + 1,
      'stale_timestamp',
    ],
  ])('treats a timestamp %s as %s', (_, timestamp, verdict) => {
    expect(verify(signed({ timestamp }))).toBe(verdict);
  });

  it('accepts a header whose second signature is the valid one (rotation)', () => {
    const request = signed();
    const stale = signWebhook({
      id: ID,
      timestamp: NOW_S,
      body: BODY,
      secret: OLD[0]!,
    });
    expect(
      verify({ ...request, signature: `${stale} ${request.signature}` }),
    ).toBe('valid');
  });

  it('accepts a request signed with either configured secret while it rotates', () => {
    const oldKey = OLD[0];
    expect(oldKey).toBeDefined();
    expect(verify(signed({}, oldKey), [...OLD, ...NEW])).toBe('valid');
    expect(verify(signed({}, oldKey), NEW)).toBe('bad_signature');
  });

  it.each([
    ['another version', 'v2,AAAA'],
    ['malformed base64', 'v1,@@@'],
    ['a short digest', 'v1,AAAA'],
    ['no version', 'AAAA'],
  ])('refuses %s without throwing', (_, signature) => {
    expect(verify({ ...signed(), signature })).toBe('bad_signature');
  });

  it('refuses a valid digest with junk after it: base64 is read strictly', () => {
    const request = signed();
    expect(verify({ ...request, signature: `${request.signature}!!` })).toBe(
      'bad_signature',
    );
  });

  it('refuses a timestamp that is not whole seconds, even signed as such', () => {
    expect(verify(signed({ timestamp: NOW_S + 0.5 }))).toBe('bad_signature');
  });

  it('refuses a valid digest offered under another version', () => {
    const request = signed();
    expect(
      verify({
        ...request,
        signature: request.signature.replace(/^v1,/, 'v2,'),
      }),
    ).toBe('bad_signature');
  });

  it.each([['id'], ['timestamp'], ['signature']] as const)(
    'refuses a request missing its %s header',
    (header) => {
      expect(verify({ ...signed(), [header]: undefined })).toBe(
        'missing_headers',
      );
    },
  );
});

describe('parseWebhookSecrets', () => {
  it('reads several space-separated secrets for a rotation', () => {
    expect(
      parseWebhookSecrets(
        'whsec_b2xkLXdlYmhvb2stc2VjcmV0LWZvci10ZXN0cw== whsec_bmV3LXdlYmhvb2stc2VjcmV0LWZvci10ZXN0cw==',
      ),
    ).toHaveLength(2);
  });

  it.each([
    ['no whsec_ prefix', 'b2xkLXdlYmhvb2stc2VjcmV0'],
    ['an empty key', 'whsec_'],
    ['a key under 24 bytes', `whsec_${Buffer.alloc(23).toString('base64')}`],
    ['nothing', ''],
  ])('refuses %s', (_, raw) => {
    expect(() => parseWebhookSecrets(raw)).toThrow();
  });
});
