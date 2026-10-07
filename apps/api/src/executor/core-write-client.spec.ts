import {
  CoreUnavailableError,
  type CoreWriteBody,
  type FetchLike,
} from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import { createCoreWriteClient } from './core-write-client.js';

const EXECUTOR_KEY = 'dev-core-executor-key';
const BODY: CoreWriteBody = {
  action_id: 'act_kqmxtbwhpvra',
  customer_id: 'cus_07',
  transaction_ids: ['tx_cu01a'],
  reason_code: 'unrecognized_charge',
};
const ACCEPTED = {
  id: 'dsp_1',
  action_id: BODY.action_id,
  transaction_ids: BODY.transaction_ids,
  status: 'accepted',
};

function clientAnswering(answer: () => Promise<Response>) {
  const seen: { url: string; headers: Headers; body: unknown }[] = [];
  const fetch: FetchLike = (input, init) => {
    seen.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(
        typeof init?.body === 'string' ? init.body : '',
      ) as unknown,
    });
    return answer();
  };
  return {
    seen,
    core: createCoreWriteClient({
      baseUrl: 'http://core',
      executorKey: EXECUTOR_KEY,
      fetch,
    }),
  };
}

describe('createCoreWriteClient (02 G3)', () => {
  it.each([
    ['open_dispute', 'http://core/disputes'],
    ['resend_cep', 'http://core/cep/resend'],
    ['escalate_fraud', 'http://core/fraud/escalations'],
  ] as const)('posts %s to its endpoint with both keys', async (type, url) => {
    const { core, seen } = clientAnswering(() =>
      Promise.resolve(Response.json(ACCEPTED, { status: 201 })),
    );
    expect(await core.write(type, BODY, BODY.action_id)).toEqual({
      outcome: 'accepted',
      result: ACCEPTED,
    });
    expect(seen[0]?.url).toBe(url);
    expect(seen[0]?.headers.get('x-executor-key')).toBe(EXECUTOR_KEY);
    expect(seen[0]?.headers.get('idempotency-key')).toBe(BODY.action_id);
    expect(seen[0]?.body).toEqual(BODY);
  });

  it.each(['transactions_not_owned', 'idempotency_key_reused'])(
    'reports a 422 %s as a final refusal',
    async (error) => {
      const { core } = clientAnswering(() =>
        Promise.resolve(Response.json({ error }, { status: 422 })),
      );
      expect(await core.write('open_dispute', BODY, BODY.action_id)).toEqual({
        outcome: 'refused',
        reason: error,
      });
    },
  );

  it.each([
    ['a 500', () => Promise.resolve(new Response(null, { status: 500 }))],
    [
      'a 401',
      () =>
        Promise.resolve(
          Response.json({ error: 'unauthorized' }, { status: 401 }),
        ),
    ],
    [
      'a refused connection',
      () => Promise.reject(new TypeError('fetch failed')),
    ],
    [
      'a body outside the contract',
      () => Promise.resolve(Response.json({ ok: true }, { status: 201 })),
    ],
  ])(
    'throws CoreUnavailableError on %s, so the sweeper retries',
    async (_, answer) => {
      const { core } = clientAnswering(answer);
      await expect(
        core.write('open_dispute', BODY, BODY.action_id),
      ).rejects.toBeInstanceOf(CoreUnavailableError);
    },
  );
});
