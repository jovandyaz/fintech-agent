import { maskPii } from './mask.js';
import { redactCredentials } from './redact.js';

/**
 * The single JSON log line a service writes when it cannot start, for the
 * processes without the Nest logger. The reason is masked and redacted (02 G6);
 * a non-Error throw is named by its kind only, since it can hold anything.
 */
export function bootFailureLine(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : `[${typeof error === 'object' ? 'Object' : typeof error}]`;
  return JSON.stringify({
    level: 'error',
    event: 'boot_failed',
    reason: maskPii(redactCredentials(message)),
    timestamp: new Date().toISOString(),
  });
}
