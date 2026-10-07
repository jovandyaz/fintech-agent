import { OpenTelemetry } from '@ai-sdk/otel';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace';
import type { Telemetry } from 'ai';

import { maskingSpanProcessor } from '../src/agent/core/telemetry.js';

/** A per-call AI SDK integration whose finished spans the test reads back. */
export interface CapturedSpans {
  telemetry: Telemetry;
  spans: () => ReadableSpan[];
  /** Every name and attribute the exporter received, as one string to scan. */
  text: () => string;
}

/**
 * Spans exported in memory; `masked: false` skips the masking processor, so
 * a test can show what the telemetry options alone keep out.
 */
export function captureSpans({ masked = true } = {}): CapturedSpans {
  const exporter = new InMemorySpanExporter();
  const exporting: SpanProcessor = new SimpleSpanProcessor({ exporter });
  const provider = new TracerProvider({
    spanProcessors: [masked ? maskingSpanProcessor(exporting) : exporting],
  });
  const spans = (): ReadableSpan[] => exporter.getFinishedSpans();
  return {
    telemetry: new OpenTelemetry({ tracer: provider.getTracer('test') }),
    spans,
    text: () =>
      JSON.stringify(
        spans().map((span) => ({
          name: span.name,
          attributes: span.attributes,
          events: span.events.map(({ name, attributes }) => ({
            name,
            attributes,
          })),
          links: span.links.map(({ attributes }) => attributes),
          status: span.status.message,
        })),
      ),
  };
}
