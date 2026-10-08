import { maskPii } from '@fintech-agent/contracts';

import type { RedactorCase } from './redactor-cases.js';
import { wilson } from './stats.js';
import type { Count } from './report.js';

// Spacing and punctuation between the words of a secret leak nothing, so a
// redactor that returns each word as its own span still covers it.
const REVEALING = /[\p{L}\p{N}]/u;

/** One redactor call as the runner makes it: the spans it applied, degraded on an error or timeout, and what it cost. */
export type Redact = (
  textMasked: string,
) => Promise<{ spans: readonly string[]; degraded: boolean; costUsd: number }>;

/** How the redactor did on one case; no text, so no secret reaches the results. */
export interface RedactorOutcome {
  id: string;
  covered: boolean;
  /** Applied spans reaching a letter or digit outside every secret. */
  overRedactedSpans: number;
  degraded: boolean;
}

/** 03's redactor recall and over-redaction, reported and never a gate. */
export interface RedactorRecall {
  recall: Count;
  overRedaction: Count;
  degraded: number;
  costUsd: number;
  outcomes: RedactorOutcome[];
}

const rangesOf = (text: string, part: string): [number, number][] => {
  const ranges: [number, number][] = [];
  for (let at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + 1)) {
    ranges.push([at, at + part.length]);
  }
  return ranges;
};

// replaceAll takes occurrences left to right without overlap, so a span
// covers only those, never the overlapping ones indexOf would also find.
const replacedRanges = (text: string, span: string): [number, number][] => {
  const ranges: [number, number][] = [];
  for (
    let at = text.indexOf(span);
    at >= 0;
    at = text.indexOf(span, at + span.length)
  ) {
    ranges.push([at, at + span.length]);
  }
  return ranges;
};

const revealing = (text: string, [start, end]: [number, number]): number[] =>
  Array.from({ length: end - start }, (_, offset) => start + offset).filter(
    (index) => REVEALING.test(text[index] ?? ''),
  );

const HIDDEN = '\u0000';

/**
 * Whether every letter and digit of every secret falls inside an applied
 * span, and how many spans reach outside the secrets. The spans are
 * replayed in order, as the intake applies them: an occurrence an earlier
 * span already replaced covers nothing again.
 */
export function coverage(
  text: string,
  secrets: readonly string[],
  spans: readonly string[],
): { covered: boolean; overRedactedSpans: number } {
  const secret = new Set(
    secrets.flatMap((part) =>
      rangesOf(text, part).flatMap((range) => revealing(text, range)),
    ),
  );
  const redacted = new Set<number>();
  let view = text;
  let overRedactedSpans = 0;
  for (const span of spans) {
    const ranges = replacedRanges(view, span);
    for (const [start, end] of ranges) {
      for (let index = start; index < end; index += 1) redacted.add(index);
      view = `${view.slice(0, start)}${HIDDEN.repeat(end - start)}${view.slice(end)}`;
    }
    if (
      ranges.some((range) =>
        revealing(text, range).some((index) => !secret.has(index)),
      )
    ) {
      overRedactedSpans += 1;
    }
  }
  return {
    covered:
      secret.size > 0 && [...secret].every((index) => redacted.has(index)),
    overRedactedSpans,
  };
}

const countOf = (successes: number, n: number): Count => ({
  successes,
  n,
  ...wilson(successes, n),
});

/** Runs the redactor on each case after the deterministic masker, as the intake does. */
export async function redactorRecall(
  cases: readonly RedactorCase[],
  redact: Redact,
): Promise<RedactorRecall> {
  const outcomes: RedactorOutcome[] = [];
  let costUsd = 0;
  for (const { id, text, secrets } of cases) {
    const masked = maskPii(text);
    const call = await redact(masked);
    costUsd += call.costUsd;
    outcomes.push({
      id,
      degraded: call.degraded,
      ...coverage(masked, secrets, call.spans),
    });
  }
  return {
    recall: countOf(
      outcomes.filter(({ covered }) => covered).length,
      outcomes.length,
    ),
    overRedaction: countOf(
      outcomes.filter(({ overRedactedSpans }) => overRedactedSpans > 0).length,
      outcomes.length,
    ),
    degraded: outcomes.filter(({ degraded }) => degraded).length,
    costUsd,
    outcomes,
  };
}
