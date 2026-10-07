import { SpanStatusCode } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace';
import { describe, expect, it } from 'vitest';

import { maskingSpanProcessor } from './telemetry.js';

const CARD = '4111 1111 1111 1111';
const PHONE = '5512345678';
const EIGHT_DIGITS = /\d{8,}/;

function tracing() {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({
    spanProcessors: [
      maskingSpanProcessor(new SimpleSpanProcessor({ exporter })),
    ],
  });
  return { exporter, tracer: provider.getTracer('test') };
}

describe('maskingSpanProcessor (02 G6, Traces)', () => {
  it('masks every attribute, event, link and the status before the exporter sees the span', () => {
    const { exporter, tracer } = tracing();
    const linked = tracer.startSpan('linked');
    linked.end();
    const span = tracer.startSpan(`chat ${PHONE}`, {
      links: [
        { context: linked.spanContext(), attributes: { note: `tel ${PHONE}` } },
      ],
    });
    span.setAttributes({
      'ai.prompt': `mi tarjeta ${CARD}`,
      'ai.response.text': ['ok', `tel ${PHONE}`],
      'gen_ai.usage.input_tokens': 1234,
      'customer.phone': Number(PHONE),
    });
    span.addEvent('tool-result', { output: `{"clabe":"${CARD}"}` });
    span.setStatus({ code: SpanStatusCode.ERROR, message: `tel ${PHONE}` });
    span.end();

    const [, exported] = exporter.getFinishedSpans();
    const seen = JSON.stringify({
      name: exported?.name,
      attributes: exported?.attributes,
      events: exported?.events.map(({ name, attributes }) => ({
        name,
        attributes,
      })),
      links: exported?.links.map(({ attributes }) => attributes),
      status: exported?.status,
    });
    expect(seen).not.toMatch(EIGHT_DIGITS);
    expect(seen).not.toContain(CARD);
    expect(exported?.attributes['gen_ai.usage.input_tokens']).toBe(1234);
    expect(exported?.status.code).toBe(SpanStatusCode.ERROR);
    expect(exported?.events[0]?.name).toBe('tool-result');
  });

  it('hands the exporter a plain copy whose own properties are masked', () => {
    const { exporter, tracer } = tracing();
    const span = tracer.startSpan('chat');
    span.setAttribute('ai.prompt', `tel ${PHONE}`);
    span.end();
    const [exported] = exporter.getFinishedSpans();
    const own: unknown = Object.getOwnPropertyDescriptor(
      exported,
      'attributes',
    )?.value;
    expect(JSON.stringify(own)).not.toMatch(EIGHT_DIGITS);
  });

  it('keeps the span identity and timing the exporter needs', () => {
    const { exporter, tracer } = tracing();
    const span = tracer.startSpan('invoke_agent');
    span.end();
    const [exported] = exporter.getFinishedSpans();
    expect(exported?.spanContext().spanId).toBe(span.spanContext().spanId);
    expect(exported?.duration).toEqual(expect.any(Array));
    expect(exported?.ended).toBe(true);
  });

  it('hands start, flush and shutdown to the next processor', async () => {
    const calls: string[] = [];
    const next: SpanProcessor = {
      onStart: () => calls.push('start'),
      onEnd: () => calls.push('end'),
      forceFlush: () => {
        calls.push('flush');
        return Promise.resolve();
      },
      shutdown: () => {
        calls.push('shutdown');
        return Promise.resolve();
      },
    };
    const provider = new TracerProvider({
      spanProcessors: [maskingSpanProcessor(next)],
    });
    provider.getTracer('test').startSpan('chat').end();
    await provider.forceFlush();
    await provider.shutdown();
    expect(calls).toEqual(['start', 'end', 'flush', 'shutdown']);
  });
});
