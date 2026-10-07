import { describe, expect, it } from 'vitest';

import {
  CoreUnavailableError,
  createCoreClient,
  type FetchLike,
} from './core-client.js';

const READ_KEY = 'dev-core-read-key';
const SETTLED_SPEI = {
  id: 'tx_so01a',
  customer_id: 'cus_01',
  amount: -1250.5,
  created_at: '2026-10-01T10:00:00-06:00',
  status: 'settled',
  type: 'spei_out',
  counterparty_name: 'Ana',
  counterparty_clabe: '•••• 7891',
  tracking_key: '•••• 0001',
  numeric_reference: '1234567',
  settled_at: '2026-10-01T10:00:05-06:00',
  hold_reason: null,
  return_reason: null,
  returned_at: null,
  reversal_credit_id: null,
  reverses_tx_id: null,
  reject_reason: null,
  cep_available: true,
};

function clientAnswering(answer: () => Promise<Response>) {
  const seen: { url: string; key: string | null }[] = [];
  const fetch: FetchLike = (input, init) => {
    seen.push({
      url: String(input),
      key: new Headers(init?.headers).get('x-core-key'),
    });
    return answer();
  };
  return {
    seen,
    core: createCoreClient({
      baseUrl: 'http://core',
      readKey: READ_KEY,
      fetch,
    }),
  };
}

describe('createCoreClient', () => {
  it('reads a transaction with the read key and parses it', async () => {
    const { core, seen } = clientAnswering(() =>
      Promise.resolve(Response.json(SETTLED_SPEI)),
    );
    expect(await core.transaction('tx_so01a')).toEqual(SETTLED_SPEI);
    expect(seen).toEqual([
      { url: 'http://core/transactions/tx_so01a', key: READ_KEY },
    ]);
  });

  it('encodes the id into one path segment', async () => {
    const { core, seen } = clientAnswering(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    );
    await core.transaction('../customers/cus_02');
    expect(seen[0]?.url).toBe(
      'http://core/transactions/..%2Fcustomers%2Fcus_02',
    );
  });

  it('resolves a missing record to null', async () => {
    const { core } = clientAnswering(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    );
    expect(await core.transaction('tx_nope')).toBeNull();
  });

  it.each([
    ['a 500', () => Promise.resolve(new Response(null, { status: 500 }))],
    [
      'a refused connection',
      () => Promise.reject(new TypeError('fetch failed')),
    ],
    ['a body that is not JSON', () => Promise.resolve(new Response('<html>'))],
    [
      'a body outside the contract',
      () =>
        Promise.resolve(Response.json({ ...SETTLED_SPEI, amount: 'mucho' })),
    ],
  ])('throws CoreUnavailableError on %s', async (_, answer) => {
    const { core } = clientAnswering(answer);
    await expect(core.transaction('tx_so01a')).rejects.toBeInstanceOf(
      CoreUnavailableError,
    );
  });
});
