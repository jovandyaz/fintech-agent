import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

/** One scripted answer of the model to a `generate` call. */
export type GenerateResult = Awaited<
  ReturnType<MockLanguageModelV4['doGenerate']>
>;
type Usage = GenerateResult['usage'];
type FinishReason = GenerateResult['finishReason']['unified'];

const PROVIDER_URL = 'https://provider.test/v1/messages';
const DEFAULT_INPUT_TOKENS = 11;
const DEFAULT_OUTPUT_TOKENS = 7;

/** The `429` body Anthropic sends once a workspace spend limit is reached. */
export const SPEND_LIMIT_429_BODY =
  '{"type":"error","error":{"type":"rate_limit_error","message":"enforced_spend_limit_reached"}}';
/**
 * The `400` body Anthropic sends once a workspace's specified API usage
 * limits are reached; the agent runs in a dedicated workspace (01).
 */
export const SPEND_LIMIT_400_BODY =
  '{"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified workspace API usage limits."}}';

export function usage(
  input: number | undefined = DEFAULT_INPUT_TOKENS,
  output: number | undefined = DEFAULT_OUTPUT_TOKENS,
  cacheRead = 0,
): Usage {
  return {
    inputTokens: {
      total: input,
      noCache: input === undefined ? undefined : input - cacheRead,
      cacheRead,
      cacheWrite: 0,
    },
    outputTokens: { total: output, text: output, reasoning: 0 },
  };
}

const answer = (
  content: GenerateResult['content'],
  reason: FinishReason,
  reported: Usage,
): GenerateResult => ({
  content,
  finishReason: { unified: reason, raw: reason },
  usage: reported,
  warnings: [],
});

let toolCalls = 0;

export const toolCallResponse = (
  toolName: string,
  input: unknown,
  reported: Usage = usage(),
  toolCallId = `call-${toolName}-${++toolCalls}`,
): GenerateResult =>
  answer(
    [{ type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input) }],
    'tool-calls',
    reported,
  );

export const objectResponse = (
  value: unknown,
  reported: Usage = usage(),
): GenerateResult =>
  answer([{ type: 'text', text: JSON.stringify(value) }], 'stop', reported);

export const malformedJson = (): GenerateResult =>
  answer([{ type: 'text', text: '{"category": ' }], 'stop', usage());

/**
 * A model that answers each call with the next scripted response and fails a
 * call the script did not plan for. A response may throw to script an error.
 */
export function inOrder(
  ...responses: (() => GenerateResult)[]
): MockLanguageModelV4 {
  let call = 0;
  return new MockLanguageModelV4({
    doGenerate: () =>
      Promise.resolve().then(() => {
        const next = responses[call++];
        if (!next) {
          throw new Error(`Unexpected model call #${call}`);
        }
        return next();
      }),
  });
}

export const callError = (
  statusCode: number,
  responseBody = '',
  responseHeaders: Record<string, string> = {},
): APICallError =>
  new APICallError({
    message: 'provider refused',
    url: PROVIDER_URL,
    requestBodyValues: {},
    statusCode,
    responseBody,
    responseHeaders,
  });

/** A rate limit the SDK retries at once, so tests never wait. */
export const tooManyRequests = (): APICallError =>
  callError(429, '', { 'retry-after-ms': '0' });
