import { APICallError, LoadAPIKeyError, RetryError, generateText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import {
  SPEND_LIMIT_400_BODY,
  SPEND_LIMIT_429_BODY,
  callError,
  tooManyRequests,
} from '../../../test/mock-model.js';
import {
  PROVIDER_ERROR,
  isProviderOutage,
  providerErrorOf,
  watchProvider,
} from './provider-errors.js';

const afterRetries = (lastError: unknown): RetryError =>
  new RetryError({
    message: 'retries exhausted',
    reason: 'maxRetriesExceeded',
    errors: [lastError, lastError, lastError],
  });

describe('providerErrorOf', () => {
  it('reads a missing key as no_api_key', () => {
    expect(
      providerErrorOf(
        new LoadAPIKeyError({ message: 'Anthropic API key is missing' }),
      ),
    ).toBe(PROVIDER_ERROR.noApiKey);
  });

  it.each([
    ['a 429 spend limit', callError(429, SPEND_LIMIT_429_BODY)],
    ['a 400 workspace usage limit', callError(400, SPEND_LIMIT_400_BODY)],
    [
      'a 400 usage limit outside a workspace',
      callError(
        400,
        '{"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits."}}',
      ),
    ],
    [
      'a spend limit after retries',
      afterRetries(callError(429, SPEND_LIMIT_429_BODY)),
    ],
  ])('reads %s as provider_spend_limit', (_, error) => {
    expect(providerErrorOf(error)).toBe(PROVIDER_ERROR.spendLimit);
  });

  it.each([
    ['a 429', tooManyRequests()],
    ['a 529', callError(529)],
    ['a 500', callError(500)],
    ['a 503', callError(503)],
    ['a 408', callError(408)],
    ['a 429 after retries', afterRetries(tooManyRequests())],
    [
      'a call that never got a status',
      new APICallError({
        message: 'fetch failed',
        url: 'https://provider.test/v1/messages',
        requestBodyValues: {},
      }),
    ],
    [
      'a 200 whose JSON the SDK could not parse',
      new APICallError({
        message: 'Invalid JSON response',
        url: 'https://provider.test/v1/messages',
        requestBodyValues: {},
        statusCode: 200,
      }),
    ],
    [
      'a step timeout',
      new DOMException('step timeout of 60000ms exceeded', 'TimeoutError'),
    ],
  ])('reads %s as provider_unavailable', (_, error) => {
    expect(providerErrorOf(error)).toBe(PROVIDER_ERROR.unavailable);
  });

  it.each([
    ['a 401', callError(401)],
    ['a 403', callError(403)],
    [
      'a 403 whose body names a spend limit',
      callError(403, SPEND_LIMIT_429_BODY),
    ],
  ])('reads %s as provider_auth', (_, error) => {
    expect(providerErrorOf(error)).toBe(PROVIDER_ERROR.auth);
  });

  it.each([
    ['a 400', callError(400, '{"error":{"message":"bad request"}}')],
    ['a 404', callError(404)],
  ])('reads %s as provider_rejected', (_, error) => {
    expect(providerErrorOf(error)).toBe(PROVIDER_ERROR.rejected);
  });

  it("reads an error that is not the provider's as none", () => {
    expect(providerErrorOf(new Error('boom'))).toBeNull();
    expect(providerErrorOf('boom')).toBeNull();
    expect(
      providerErrorOf(new DOMException('worker stopping', 'AbortError')),
    ).toBeNull();
  });
});

describe('isProviderOutage (01 §Failure handling, breaker)', () => {
  it.each([
    ['a 429', tooManyRequests(), true],
    ['a 529', callError(529), true],
    ['a 503 after the SDK retries', afterRetries(callError(503)), true],
    ['a step timeout', new DOMException('Step timeout', 'TimeoutError'), false],
    ['a 408', callError(408), false],
    ['a spend-limit 429', callError(429, SPEND_LIMIT_429_BODY), false],
    ['a non-provider error', new Error('bug'), false],
  ])('%s → %s', (_, error, outage) => {
    expect(isProviderOutage(error)).toBe(outage);
  });
});

describe('watchProvider', () => {
  const NO_WAIT = { 'retry-after-ms': '0' };
  const refusing = (error: () => Error) => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: () => {
        calls += 1;
        return Promise.reject(error());
      },
    });
    return { model, calls: () => calls };
  };
  const caught = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => error,
    );

  it('stops the SDK from retrying a spend limit, which no retry clears', async () => {
    const refused = refusing(() =>
      callError(429, SPEND_LIMIT_429_BODY, NO_WAIT),
    );
    const watched = watchProvider(refused.model);
    const error = await caught(
      generateText({ model: watched.model, prompt: 'hola' }),
    );
    expect(refused.calls()).toBe(1);
    expect(providerErrorOf(watched.causeOf(error))).toBe(
      PROVIDER_ERROR.spendLimit,
    );
  });

  it('still lets the SDK retry an ordinary 429', async () => {
    const refused = refusing(tooManyRequests);
    await caught(
      generateText({
        model: watchProvider(refused.model).model,
        prompt: 'hola',
      }),
    );
    expect(refused.calls()).toBe(3);
  });

  it('reads a timeout during the retry wait as the refusal that caused the wait', async () => {
    const slow = { 'retry-after-ms': '30000' };
    const refused = refusing(() => callError(429, '', slow));
    const watched = watchProvider(refused.model);
    const error = await caught(
      generateText({
        model: watched.model,
        prompt: 'hola',
        timeout: { totalMs: 50 },
      }),
    );
    expect(error).toMatchObject({ name: 'AbortError' });
    const cause = watched.causeOf(error);
    expect(providerErrorOf(cause)).toBe(PROVIDER_ERROR.unavailable);
    expect(isProviderOutage(cause)).toBe(true);
  });

  it('leaves any other error as it is', () => {
    const watched = watchProvider(refusing(tooManyRequests).model);
    const bug = new Error('bug');
    expect(watched.causeOf(bug)).toBe(bug);
  });
});
