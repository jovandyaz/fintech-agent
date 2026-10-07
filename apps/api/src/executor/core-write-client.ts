import {
  CORE_WRITE_PATHS,
  CORE_WRITE_REFUSALS,
  CoreUnavailableError,
  CoreWriteResultSchema,
  type CoreWriteBody,
  type CoreWriteRefusal,
  type CoreWriteResult,
  type FetchLike,
  type WritableAction,
} from '@fintech-agent/contracts';

const CORE_TIMEOUT_MS = 5_000;
const UNPROCESSABLE = 422;

export type WriteOutcome =
  | { outcome: 'accepted'; result: CoreWriteResult }
  | { outcome: 'refused'; reason: CoreWriteRefusal };

export interface CoreWriteClient {
  write: (
    type: WritableAction,
    body: CoreWriteBody,
    idempotencyKey: string,
  ) => Promise<WriteOutcome>;
}

const isRefusal = (value: unknown): value is CoreWriteRefusal =>
  (CORE_WRITE_REFUSALS as readonly unknown[]).includes(value);

async function bodyOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new CoreUnavailableError('core answered a body that is not JSON');
  }
}

/**
 * The only write path to core-mock (02 G1): the executor key and the
 * action's idempotency key on every call. A 422 is a final refusal; any other
 * failure throws `CoreUnavailableError`, which leaves the execution `started`
 * for the sweeper to retry with the same key.
 */
export function createCoreWriteClient(options: {
  baseUrl: string;
  executorKey: string;
  fetch: FetchLike;
}): CoreWriteClient {
  return {
    async write(type, body, idempotencyKey) {
      let response: Response;
      try {
        response = await options.fetch(
          new URL(CORE_WRITE_PATHS[type], options.baseUrl),
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-executor-key': options.executorKey,
              'idempotency-key': idempotencyKey,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
          },
        );
      } catch (error) {
        throw new CoreUnavailableError(String(error));
      }
      if (response.status === UNPROCESSABLE) {
        const refused = await bodyOf(response);
        const reason = (refused as { error?: unknown } | null)?.error;
        if (isRefusal(reason)) return { outcome: 'refused', reason };
      }
      if (!response.ok) {
        throw new CoreUnavailableError(`core answered ${response.status}`);
      }
      const parsed = CoreWriteResultSchema.safeParse(await bodyOf(response));
      if (!parsed.success) {
        throw new CoreUnavailableError('core answered outside its contract');
      }
      return { outcome: 'accepted', result: parsed.data };
    },
  };
}
