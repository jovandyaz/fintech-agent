import { maskPii } from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import { coverage, redactorRecall, type Redact } from './redactor.js';
import { REDACTOR_CASES } from './redactor-cases.js';

describe('the redactor recall set (03: strings the masker misses by construction)', () => {
  it('holds 20 cases with unique ids', () => {
    expect(REDACTOR_CASES).toHaveLength(20);
    expect(new Set(REDACTOR_CASES.map(({ id }) => id)).size).toBe(20);
  });

  it.each(REDACTOR_CASES.map((item) => [item.id, item] as const))(
    '%s: every secret survives the deterministic masker',
    (_, { text, secrets }) => {
      expect(secrets.length).toBeGreaterThan(0);
      for (const secret of secrets) expect(maskPii(text)).toContain(secret);
    },
  );
});

describe('coverage', () => {
  const TEXT = 'La clave dinámica era sol luna estrella mar, la usé.';
  const SECRET = ['sol luna estrella mar'];

  it('covers a secret returned whole or word by word', () => {
    expect(coverage(TEXT, SECRET, ['sol luna estrella mar'])).toEqual({
      covered: true,
      overRedactedSpans: 0,
    });
    expect(
      coverage(TEXT, SECRET, ['sol', 'luna', 'estrella', 'mar']).covered,
    ).toBe(true);
  });

  it('leaves a secret uncovered when part of it is left readable', () => {
    expect(coverage(TEXT, SECRET, ['sol luna estrella']).covered).toBe(false);
    expect(coverage(TEXT, SECRET, []).covered).toBe(false);
  });

  it('counts each span that reaches outside the secret as over-redaction', () => {
    expect(
      coverage(TEXT, SECRET, [
        'clave dinámica era sol luna estrella mar',
        'usé',
      ]).overRedactedSpans,
    ).toBe(2);
  });

  it('replays the spans in order, as the intake applies them, so an occurrence an earlier span destroyed covers nothing', () => {
    expect(coverage('abcde y cde', ['abcde'], ['abc', 'cde']).covered).toBe(
      false,
    );
  });

  it('replays a span over non-overlapping occurrences only, as replaceAll does', () => {
    expect(
      coverage('Mi clave es aaaa, gracias.', ['aaaa'], ['aaa']).covered,
    ).toBe(false);
  });

  it('needs every secret of a case covered', () => {
    const text = 'Mi NIP es mi año más dos, y nací en dos mil diez.';
    expect(
      coverage(text, ['mi año más dos', 'dos mil diez'], ['dos mil diez'])
        .covered,
    ).toBe(false);
  });
});

describe('redactorRecall', () => {
  it('reads recall and over-redaction over the cases, on the masked text the intake sends', async () => {
    const seen: string[] = [];
    const redact: Redact = (textMasked) => {
      seen.push(textMasked);
      return Promise.resolve({
        spans: textMasked.includes('Firulais') ? ['Firulais'] : ['Mi'],
        degraded: false,
        costUsd: 0.01,
      });
    };
    const recall = await redactorRecall(REDACTOR_CASES.slice(0, 3), redact);
    expect(seen).toEqual(
      REDACTOR_CASES.slice(0, 3).map(({ text }) => maskPii(text)),
    );
    expect(recall.recall).toMatchObject({ successes: 1, n: 3 });
    expect(recall.overRedaction).toMatchObject({ successes: 1, n: 3 });
    expect(recall.costUsd).toBeCloseTo(0.03, 6);
    expect(recall.outcomes.map(({ id, covered }) => [id, covered])).toEqual([
      ['RED-01', false],
      ['RED-02', false],
      ['RED-03', true],
    ]);
  });

  it('sends the redactor the text after the deterministic masker, never the raw text (02 G6)', async () => {
    const seen: string[] = [];
    await redactorRecall(
      [
        {
          id: 'RED-X',
          text: 'Mi clave es gatoazul y mi CLABE 012180001234567899.',
          secrets: ['gatoazul'],
        },
      ],
      (textMasked) => {
        seen.push(textMasked);
        return Promise.resolve({ spans: [], degraded: false, costUsd: 0 });
      },
    );
    expect(seen.join('')).not.toContain('012180001234567899');
    expect(seen.join('')).toContain('gatoazul');
  });

  it('counts a degraded call as a miss and reports it', async () => {
    const recall = await redactorRecall(REDACTOR_CASES.slice(0, 2), () =>
      Promise.resolve({ spans: [], degraded: true, costUsd: 0 }),
    );
    expect(recall).toMatchObject({
      recall: { successes: 0, n: 2 },
      degraded: 2,
    });
  });
});

describe('the recall outcomes it records', () => {
  it('carry no text, so no secret reaches the results file', async () => {
    const recall = await redactorRecall(REDACTOR_CASES.slice(0, 1), () =>
      Promise.resolve({
        spans: ['gatoazulmarino'],
        degraded: false,
        costUsd: 0,
      }),
    );
    expect(JSON.stringify(recall)).not.toContain('gatoazulmarino');
  });
});
