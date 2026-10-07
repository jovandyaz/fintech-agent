import {
  APICallError,
  NoObjectGeneratedError,
  Output,
  ToolLoopAgent,
  isStepCount,
  tool,
} from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  SPEND_LIMIT_400_BODY,
  SPEND_LIMIT_429_BODY,
  callError,
  inOrder,
  malformedJson,
  objectResponse,
  tooManyRequests,
  toolCallResponse,
  usage,
} from './mock-model.js';

const echo = tool({
  description: 'Echoes an id.',
  inputSchema: z.object({ id: z.string() }),
  execute: ({ id }) => ({ id }),
});
const ANSWER = z.object({ answer: z.string() });

const agentOf = (model: ReturnType<typeof inOrder>) =>
  new ToolLoopAgent({
    model,
    tools: { echo },
    output: Output.object({ schema: ANSWER }),
    stopWhen: isStepCount(3),
  });

describe('mock model fixtures', () => {
  it('scripts a tool call, then a structured output, in order', async () => {
    const model = inOrder(
      () => toolCallResponse('echo', { id: 'tx_1' }),
      () => objectResponse({ answer: 'ok' }, usage(40, 9)),
    );
    const result = await agentOf(model).generate({ prompt: 'hola' });
    expect(result.output).toEqual({ answer: 'ok' });
    expect(result.steps).toHaveLength(2);
    expect(result.totalUsage.inputTokens).toBe(51);
  });

  it('fails a call the script did not plan for', async () => {
    const model = inOrder(() => toolCallResponse('echo', { id: 'tx_1' }));
    await expect(agentOf(model).generate({ prompt: 'hola' })).rejects.toThrow(
      /Unexpected model call #2/,
    );
  });

  it('scripts malformed JSON as a no-object error', async () => {
    const model = inOrder(malformedJson);
    await expect(agentOf(model).generate({ prompt: 'hola' })).rejects.toSatisfy(
      (error) => NoObjectGeneratedError.isInstance(error),
    );
  });

  it('scripts provider refusals as API call errors', () => {
    const limited = tooManyRequests();
    expect(limited.statusCode).toBe(429);
    expect(limited.isRetryable).toBe(true);
    expect(limited.responseHeaders).toEqual({ 'retry-after-ms': '0' });
    expect(callError(429, SPEND_LIMIT_429_BODY).responseBody).toContain(
      'enforced_spend_limit_reached',
    );
    expect(callError(400, SPEND_LIMIT_400_BODY).responseBody).toContain(
      'specified workspace API usage limits',
    );
    expect(APICallError.isInstance(callError(500))).toBe(true);
  });
});
