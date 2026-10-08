import { OperatorViewSchema } from '@fintech-agent/contracts/console';
import { describe, expect, it } from 'vitest';

import { ApiError, UnauthorizedError, createApiClient } from './client.js';

const TOKEN = 'dev-operator-ana-token-0123456789';

function clientAnswering(
  response: () => Response,
  token: string | null = TOKEN,
) {
  const seen: { url: string; init: RequestInit | undefined }[] = [];
  let unauthorized = 0;
  const refused: (string | null)[] = [];
  const api = createApiClient({
    fetch: (input, init) => {
      seen.push({
        url:
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        init,
      });
      return Promise.resolve(response());
    },
    token: () => token,
    onUnauthorized: (usedToken) => {
      unauthorized += 1;
      refused.push(usedToken);
    },
  });
  return { api, seen, unauthorized: () => unauthorized, refused };
}

describe('createApiClient', () => {
  it('calls the api under /api with the operator token, and parses the answer', async () => {
    const { api, seen } = clientAnswering(() => Response.json({ id: 'ana' }));
    expect(await api.get('/me', OperatorViewSchema)).toEqual({ id: 'ana' });
    expect(seen[0]?.url).toBe('/api/me');
    expect(new Headers(seen[0]?.init?.headers).get('authorization')).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it('posts a JSON body', async () => {
    const { api, seen } = clientAnswering(() => Response.json({ id: 'ana' }));
    await api.post('/cases', { customer_id: 'cus_01' }, OperatorViewSchema);
    expect(seen[0]?.init?.method).toBe('POST');
    expect(new Headers(seen[0]?.init?.headers).get('content-type')).toBe(
      'application/json',
    );
    expect(seen[0]?.init?.body).toBe('{"customer_id":"cus_01"}');
  });

  it('posts a command that takes no body without one', async () => {
    const { api, seen } = clientAnswering(() => Response.json({ id: 'ana' }));
    await api.post('/cases/case_abc/rerun', undefined, OperatorViewSchema);
    expect(seen[0]?.init?.method).toBe('POST');
    expect(seen[0]?.init?.body).toBeUndefined();
    expect(new Headers(seen[0]?.init?.headers).has('content-type')).toBe(false);
  });

  it('asks to sign in again on a 401, and fails the call', async () => {
    const client = clientAnswering(() => new Response(null, { status: 401 }));
    await expect(client.api.get('/me', OperatorViewSchema)).rejects.toThrow(
      UnauthorizedError,
    );
    expect(client.unauthorized()).toBe(1);
    expect(client.refused).toEqual([TOKEN]);
  });

  it('names the refusal the api gave, never a stack', async () => {
    const { api } = clientAnswering(() =>
      Response.json({ message: 'flags_not_acknowledged' }, { status: 400 }),
    );
    await expect(api.get('/me', OperatorViewSchema)).rejects.toMatchObject({
      status: 400,
      reason: 'flags_not_acknowledged',
    });
  });

  it('carries the reply checks a refused reply failed, and only strings', async () => {
    const { api } = clientAnswering(() =>
      Response.json(
        {
          message: 'invalid_reply',
          codes: ['LINK_IN_REPLY', 7, 'PII_IN_REPLY'],
        },
        { status: 400 },
      ),
    );
    await expect(api.get('/me', OperatorViewSchema)).rejects.toMatchObject({
      reason: 'invalid_reply',
      codes: ['LINK_IN_REPLY', 'PII_IN_REPLY'],
    });
  });

  it('carries no codes when the refusal names none', async () => {
    const { api } = clientAnswering(() =>
      Response.json({ message: 'conflict' }, { status: 409 }),
    );
    await expect(api.get('/me', OperatorViewSchema)).rejects.toMatchObject({
      codes: [],
    });
  });

  it('refuses an answer outside its contract', async () => {
    const { api } = clientAnswering(() =>
      Response.json({ id: 'ana', is_canary: true }),
    );
    await expect(api.get('/me', OperatorViewSchema)).rejects.toThrow(ApiError);
  });

  it('sends no authorization header without a token', async () => {
    const { api, seen } = clientAnswering(
      () => Response.json({ id: 'ana' }),
      null,
    );
    await api.get('/me', OperatorViewSchema);
    expect(new Headers(seen[0]?.init?.headers).has('authorization')).toBe(
      false,
    );
  });
});
