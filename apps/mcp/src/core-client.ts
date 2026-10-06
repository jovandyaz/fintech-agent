import type { Customer, Transaction } from '@fintech-agent/data';

const CORE_TIMEOUT_MS = 5_000;
const NOT_FOUND = 404;

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface CorePage {
  items: Transaction[];
  total: number;
  next_cursor: string | null;
}

/** Thrown when core-mock is unreachable or answers an error other than 404. */
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
 * Read-only client for core-mock. It authenticates with the MCP server's own
 * read key; the case token never leaves this process (02 G4). A missing record
 * resolves to null.
 */
export function createCoreClient(options: {
  baseUrl: string;
  readKey: string;
  fetch: FetchLike;
}): CoreClient {
  async function get<T>(path: string): Promise<T | null> {
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
    try {
      return (await response.json()) as T;
    } catch {
      throw new CoreUnavailableError('core answered a body that is not JSON');
    }
  }

  const segment = encodeURIComponent;
  return {
    customer: (id) => get<Customer>(`/customers/${segment(id)}`),
    transaction: (id) => get<Transaction>(`/transactions/${segment(id)}`),
    transactions: (customerId, query) =>
      get<CorePage>(
        `/customers/${segment(customerId)}/transactions?${query.toString()}`,
      ),
  };
}
