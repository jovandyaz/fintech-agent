import { APICallError, LoadAPIKeyError, RetryError } from 'ai';

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

/** Whether a job-level retry may clear the failure. */
export const isRetryable = (code: ProviderErrorCode): boolean =>
  code === PROVIDER_ERROR.unavailable;
