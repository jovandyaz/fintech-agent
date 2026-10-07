import {
  CORE_EFFECTS_PATH,
  CORE_TIMEOUT_MS,
  CORE_WRITE_HEADERS,
  CORE_WRITE_PATHS,
  CoreRefusalSchema,
  CoreUnavailableError,
  CoreWriteResultSchema,
  type CoreWriteBody,
  type CoreWriteRefusal,
  type CoreWriteResult,
  type FetchLike,
  type WritableAction,
} from '@fintech-agent/contracts';

const NOT_FOUND = 404;
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
  /** The effect core-mock stored under the key, or null when there is none. */
  effectOf: (idempotencyKey: string) => Promise<CoreWriteResult | null>;
}

async function bodyOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new CoreUnavailableError('core answered a body that is not JSON');
  }
}

function resultOf(body: unknown, idempotencyKey: string): CoreWriteResult {
  const parsed = CoreWriteResultSchema.safeParse(body);
  if (!parsed.success || parsed.data.action_id !== idempotencyKey) {
    throw new CoreUnavailableError('core answered outside its contract');
  }
  return parsed.data;
}

/**
 * The only write path to core-mock (02 G1): the executor key and the
 * action's idempotency key on every call. A 422 refusal is final; any other
 * failure, or an answer for another action, throws `CoreUnavailableError`,
 * which leaves the execution `started` for the sweeper.
 */
export function createCoreWriteClient(options: {
  baseUrl: string;
  executorKey: string;
  fetch: FetchLike;
}): CoreWriteClient {
  async function call(path: string, init: RequestInit): Promise<Response> {
    try {
      return await options.fetch(new URL(path, options.baseUrl), {
        ...init,
        signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
      });
    } catch (error) {
      throw new CoreUnavailableError(String(error));
    }
  }

  return {
    async write(type, body, idempotencyKey) {
      const response = await call(CORE_WRITE_PATHS[type], {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [CORE_WRITE_HEADERS.executorKey]: options.executorKey,
          [CORE_WRITE_HEADERS.idempotencyKey]: idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      if (response.status === UNPROCESSABLE) {
        const refusal = CoreRefusalSchema.safeParse(await bodyOf(response));
        if (refusal.success) {
          return { outcome: 'refused', reason: refusal.data.error };
        }
      }
      if (!response.ok) {
        throw new CoreUnavailableError(`core answered ${response.status}`);
      }
      return {
        outcome: 'accepted',
        result: resultOf(await bodyOf(response), idempotencyKey),
      };
    },

    async effectOf(idempotencyKey) {
      const response = await call(
        `${CORE_EFFECTS_PATH}/${encodeURIComponent(idempotencyKey)}`,
        { headers: { [CORE_WRITE_HEADERS.executorKey]: options.executorKey } },
      );
      if (response.status === NOT_FOUND) return null;
      if (!response.ok) {
        throw new CoreUnavailableError(`core answered ${response.status}`);
      }
      return resultOf(await bodyOf(response), idempotencyKey);
    },
  };
}
