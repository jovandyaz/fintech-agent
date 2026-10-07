import { maskPii } from '@fintech-agent/contracts';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import {
  callError,
  inOrder,
  malformedJson,
  objectResponse,
} from '../../test/mock-model.js';
import {
  MAX_SPANS,
  REDACTED,
  type Redactor,
  redactCase,
} from './core/redact.js';

const TIMEOUT_MS = 50;
// The step a degraded redaction records, latency aside: nothing the model
// said or the provider answered may reach run_steps.
const DEGRADED = {
  name: 'redaction',
  outcome: 'degraded',
  spans: 0,
  usage: null,
  latencyMs: 0,
};
const redactorOf = (model: MockLanguageModelV4): Redactor => ({
  model,
  timeoutMs: TIMEOUT_MS,
});
const returning = (spans: string[]) =>
  redactorOf(inOrder(() => objectResponse({ spans })));

describe('redactCase (02 G6 Step 7)', () => {
  it('replaces each span the redactor returns, exactly, with [dato]', async () => {
    const redaction = await redactCase(
      'Mi apodo es Pelusa y mi perro se llama Firulais.',
      returning(['Pelusa', 'Firulais']),
    );
    expect(redaction.text).toBe(
      `Mi apodo es ${REDACTED} y mi perro se llama ${REDACTED}.`,
    );
    expect(redaction.step).toMatchObject({ outcome: 'passed', spans: 2 });
  });

  it('matches a span literally and replaces every occurrence', async () => {
    const redaction = await redactCase(
      'Clave a.b y clave a.b; nunca axb ni $&.',
      returning(['a.b', '$&x']),
    );
    expect(redaction.text).toBe(
      `Clave ${REDACTED} y clave ${REDACTED}; nunca axb ni $&.`,
    );
  });

  it('applies a span of exactly 3 characters', async () => {
    const redaction = await redactCase('Soy Ana.', returning(['Ana']));
    expect(redaction.text).toBe(`Soy ${REDACTED}.`);
  });

  it('ignores a span that is not in the text or is shorter than 3 characters', async () => {
    const redaction = await redactCase(
      'Mi apodo es Pelusa.',
      returning(['Peluche', 'es', 'Pe', 'Pelusa']),
    );
    expect(redaction.text).toBe(`Mi apodo es ${REDACTED}.`);
    expect(redaction.step).toMatchObject({ spans: 1 });
  });

  it('ignores every span after the 50th', async () => {
    const words = Array.from(
      { length: MAX_SPANS + 1 },
      (_, index) => `palabra${String(index).padStart(2, '0')}`,
    );
    const redaction = await redactCase(words.join(' '), returning(words));
    expect(redaction.text).toBe(
      [...Array<string>(MAX_SPANS).fill(REDACTED), words[MAX_SPANS]].join(' '),
    );
  });

  it('sends the redactor nothing but the masked text', async () => {
    const model = inOrder(() => objectResponse({ spans: [] }));
    await redactCase('Hola, soy Ana. CLABE ••••7899', redactorOf(model));
    const [call] = model.doGenerateCalls;
    expect(call!.prompt.map(({ role }) => role)).toEqual(['system', 'user']);
    expect(JSON.stringify(call!.prompt[0])).not.toContain('Ana');
    expect(call!.prompt[1]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'text',
          text: '<mensaje_cliente>\nHola, soy Ana. CLABE ••••7899\n</mensaje_cliente>',
        },
      ],
    });
    expect(call!.prompt[1]!.content).toHaveLength(1);
  });

  it('masks the redacted text again', async () => {
    const card = '4111 1111 1111 1111';
    const redaction = await redactCase(`Mi tarjeta ${card}`, returning([]));
    expect(redaction.text).not.toContain(card);
    expect(redaction.text).toBe(maskPii(`Mi tarjeta ${card}`));
  });

  it('continues on the masked text, degraded, when the redactor errors', async () => {
    const model = inOrder(() => {
      throw callError(500);
    });
    const redaction = await redactCase(
      'Mi apodo es Pelusa.',
      redactorOf(model),
    );
    expect(redaction.text).toBe('Mi apodo es Pelusa.');
    expect({ ...redaction.step, latencyMs: 0 }).toEqual(DEGRADED);
  });

  it('continues on the masked text, degraded, when the redactor answers malformed JSON', async () => {
    const redaction = await redactCase(
      'Mi apodo es Pelusa.',
      redactorOf(inOrder(malformedJson)),
    );
    expect(redaction.text).toBe('Mi apodo es Pelusa.');
    expect({ ...redaction.step, latencyMs: 0 }).toEqual(DEGRADED);
  });

  it('continues on the masked text, degraded, when the redactor times out', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise((_, reject) => {
          abortSignal?.addEventListener('abort', () => {
            reject(new Error('aborted', { cause: abortSignal.reason }));
          });
        }),
    });
    const redaction = await redactCase(
      'Mi apodo es Pelusa.',
      redactorOf(model),
    );
    expect(redaction.text).toBe('Mi apodo es Pelusa.');
    expect({ ...redaction.step, latencyMs: 0 }).toEqual(DEGRADED);
  });

  it('skips the redactor when none is configured (no API key)', async () => {
    const redaction = await redactCase('Mi apodo es Pelusa.', null);
    expect(redaction).toEqual({ text: 'Mi apodo es Pelusa.', step: null });
  });
});
