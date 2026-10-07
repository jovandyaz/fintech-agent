import {
  APICallError,
  LoadAPIKeyError,
  RetryError,
  wrapLanguageModel,
  type LanguageModel,
  type LanguageModelMiddleware,
} from 'ai';

/**
 * The `agent_runs.error_code` of a provider failure (01 §Failure handling).
 * Only `provider_unavailable` is retried.
 */
export const PROVIDER_ERROR = {
  noApiKey: 'no_api_key',
  spendLimit: 'provider_spend_limit',
  auth: 'provider_auth',
  unavailable: 'provider_unavailable',
  rejected: 'provider_rejected',
} as const;
export type ProviderErrorCode =
  (typeof PROVIDER_ERROR)[keyof typeof PROVIDER_ERROR];

const TIMEOUT_ERROR_NAME = 'TimeoutError';
const SPEND_LIMIT_STATUSES: ReadonlySet<number> = new Set([400, 429]);
// A spend limit answers 429 or 400 yet never clears on retry, so it is told
// apart by the body: Anthropic names it in the error message.
const SPEND_LIMIT_BODY =
  /enforced_spend_limit_reached|specified (?:workspace )?API usage limits/i;
const AUTH_STATUSES: ReadonlySet<number> = new Set([401, 403]);
const UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([408, 429]);
const FIRST_SERVER_ERROR = 500;
const FIRST_CLIENT_ERROR = 400;

function codeOfCall(error: APICallError): ProviderErrorCode {
  const status = error.statusCode;
  // No status is a network failure; a 2xx is a body the SDK could not parse.
  if (status === undefined || status < FIRST_CLIENT_ERROR) {
    return PROVIDER_ERROR.unavailable;
  }
  if (
    SPEND_LIMIT_STATUSES.has(status) &&
    SPEND_LIMIT_BODY.test(error.responseBody ?? '')
  ) {
    return PROVIDER_ERROR.spendLimit;
  }
  if (AUTH_STATUSES.has(status)) return PROVIDER_ERROR.auth;
  if (UNAVAILABLE_STATUSES.has(status) || status >= FIRST_SERVER_ERROR) {
    return PROVIDER_ERROR.unavailable;
  }
  return PROVIDER_ERROR.rejected;
}

/**
 * The error code of a failed model call, looking through the SDK's retry
 * wrapper to the last attempt; `null` for an error that is not the
 * provider's, which the caller reports as its own.
 */
export function providerErrorOf(error: unknown): ProviderErrorCode | null {
  if (RetryError.isInstance(error)) return providerErrorOf(error.lastError);
  if (LoadAPIKeyError.isInstance(error)) return PROVIDER_ERROR.noApiKey;
  if (APICallError.isInstance(error)) return codeOfCall(error);
  if (error instanceof DOMException && error.name === TIMEOUT_ERROR_NAME) {
    return PROVIDER_ERROR.unavailable;
  }
  return null;
}

const ABORT_ERROR_NAME = 'AbortError';
const RATE_LIMITED = 429;

/**
 * Whether a failure is the provider being down or saturated (01 §Failure
 * handling): a 429 that is not a spend limit, a 529 or a 5xx after the
 * SDK's retries. Only these open the worker's breaker; a timeout, a 408 or
 * a network error does not.
 */
export function isProviderOutage(error: unknown): boolean {
  if (RetryError.isInstance(error)) return isProviderOutage(error.lastError);
  if (!APICallError.isInstance(error)) return false;
  const status = error.statusCode;
  return (
    status !== undefined &&
    codeOfCall(error) === PROVIDER_ERROR.unavailable &&
    (status === RATE_LIMITED || status >= FIRST_SERVER_ERROR)
  );
}

/** A model whose refusals the harness can read after the SDK gave up. */
export interface WatchedModel {
  model: Exclude<LanguageModel, string>;
  /**
   * The refusal behind an error: a timeout that fires while the SDK waits to
   * retry surfaces as a bare `AbortError`, so it is read as the provider
   * refusal that caused the wait.
   */
  causeOf(error: unknown): unknown;
}

/**
 * Wraps a model so a spend limit is never retried by the SDK (it does not
 * clear, 01 §Failure handling) and the last provider refusal is kept for
 * `causeOf`.
 */
export function watchProvider(
  model: Exclude<LanguageModel, string>,
): WatchedModel {
  let lastRefusal: APICallError | null = null;
  const middleware: LanguageModelMiddleware = {
    wrapGenerate: async ({ doGenerate }) => {
      try {
        return await doGenerate();
      } catch (error) {
        if (!APICallError.isInstance(error)) throw error;
        lastRefusal = error;
        if (codeOfCall(error) !== PROVIDER_ERROR.spendLimit) throw error;
        const { statusCode, responseHeaders, responseBody } = error;
        throw new APICallError({
          message: error.message,
          url: error.url,
          requestBodyValues: error.requestBodyValues,
          ...(statusCode === undefined ? {} : { statusCode }),
          ...(responseHeaders === undefined ? {} : { responseHeaders }),
          ...(responseBody === undefined ? {} : { responseBody }),
          cause: error,
          isRetryable: false,
        });
      }
    },
  };
  return {
    model: wrapLanguageModel({ model, middleware }),
    causeOf: (error) =>
      error instanceof DOMException &&
      error.name === ABORT_ERROR_NAME &&
      lastRefusal !== null
        ? lastRefusal
        : error,
  };
}
