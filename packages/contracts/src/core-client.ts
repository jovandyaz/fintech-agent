import type { z } from 'zod';

import {
  CorePageSchema,
  CustomerRecordSchema,
  TransactionRecordSchema,
  type CorePage,
  type Customer,
  type Transaction,
} from './core.js';

const CORE_TIMEOUT_MS = 5_000;
const NOT_FOUND = 404;

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Thrown when core-mock is unreachable, answers an error other than 404, or answers something outside its contract. */
export class CoreUnavailableError extends Error {}

export interface CoreClient {
  customer: (id: string) => Promise<Customer | null>;
  transaction: (id: string) => Promise<Transaction | null>;
  transactions: (
    customerId: string,
    query: URLSearchParams,
  ) => Promise<CorePage | null>;
}

/**
 * Read-only client for core-mock, authenticated with the caller's own key; a
 * case token is never forwarded (02 G4). Every answer is parsed against its
 * contract schema; a missing record resolves to null.
 */
export function createCoreClient(options: {
  baseUrl: string;
  readKey: string;
  fetch: FetchLike;
}): CoreClient {
  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    let response: Response;
    try {
      response = await options.fetch(new URL(path, options.baseUrl), {
        headers: { 'x-core-key': options.readKey },
        signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
      });
    } catch (error) {
      throw new CoreUnavailableError(String(error));
    }
    if (response.status === NOT_FOUND) return null;
    if (!response.ok) {
      throw new CoreUnavailableError(`core answered ${response.status}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new CoreUnavailableError('core answered a body that is not JSON');
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new CoreUnavailableError('core answered outside its contract');
    }
    return parsed.data;
  }

  const segment = encodeURIComponent;
  return {
    customer: (id) => get(`/customers/${segment(id)}`, CustomerRecordSchema),
    transaction: (id) =>
      get(`/transactions/${segment(id)}`, TransactionRecordSchema),
    transactions: (customerId, query) =>
      get(
        `/customers/${segment(customerId)}/transactions?${query.toString()}`,
        CorePageSchema,
      ),
  };
}
