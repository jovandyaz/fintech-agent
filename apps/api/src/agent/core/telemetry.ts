import { maskJson, maskPii } from '@fintech-agent/contracts';
import type { Attributes } from '@opentelemetry/api';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace';
import type { Telemetry, TelemetryOptions } from 'ai';

// The SDK records prompts and outputs by default (01 §Observability); the
// GenAI conventions make content opt-in, so every model call turns it off.
const NO_CONTENT = { recordInputs: false, recordOutputs: false } as const;

/**
 * The telemetry options of every model call (02 G6, Traces): no prompt or
 * output content, and the caller's integration when one is wired. With none,
 * the SDK falls back to globally registered integrations, which this app
 * never registers.
 */
export function telemetryOf(integration?: Telemetry): TelemetryOptions {
  return integration
    ? { ...NO_CONTENT, integrations: integration }
    : NO_CONTENT;
}

const maskAttributes = (attributes: Attributes): Attributes =>
  maskJson(attributes) as Attributes;

// A copy of the closed ReadableSpan field list, so a field the SDK adds
// later is left out rather than passed through unmasked.
function maskedView(span: ReadableSpan): ReadableSpan {
  return {
    name: maskPii(span.name),
    kind: span.kind,
    spanContext: () => span.spanContext(),
    ...(span.parentSpanContext && {
      parentSpanContext: span.parentSpanContext,
    }),
    startTime: span.startTime,
    endTime: span.endTime,
    status:
      span.status.message === undefined
        ? span.status
        : { ...span.status, message: maskPii(span.status.message) },
    attributes: maskAttributes(span.attributes),
    links: span.links.map((link) => ({
      ...link,
      ...(link.attributes && { attributes: maskAttributes(link.attributes) }),
    })),
    events: span.events.map((event) => ({
      ...event,
      name: maskPii(event.name),
      ...(event.attributes && {
        attributes: maskAttributes(event.attributes),
      }),
    })),
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
  };
}

/**
 * Wraps the processor that exports spans so it only ever sees them masked
 * (02 G6, Traces): name, attributes, events, links and status message go
 * through `maskPii`/`maskJson`. Content stays off by default; this is what
 * keeps a span that carries it, or an error message, from leaking PII.
 */
export function maskingSpanProcessor(next: SpanProcessor): SpanProcessor {
  return {
    onStart: (span, parentContext) => next.onStart(span, parentContext),
    onEnd: (span) => next.onEnd(maskedView(span)),
    forceFlush: () => next.forceFlush(),
    shutdown: () => next.shutdown(),
  };
}
