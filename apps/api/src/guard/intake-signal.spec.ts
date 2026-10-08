import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { injectionSignal } from './prompt-guard.js';

const FIXTURES = resolve(
  import.meta.dirname,
  '../../../../data/webhook-fixtures',
);
const ADVERSARIAL = /^ADV-/;
const textOf = (file: string): string =>
  (
    JSON.parse(readFileSync(resolve(FIXTURES, file), 'utf8')) as {
      text: string;
    }
  ).text;
const fixtureFiles = readdirSync(FIXTURES).filter((file) =>
  file.endsWith('.json'),
);

describe('injectionSignal on the webhook fixtures (01 Intake: a flag, never a block)', () => {
  it.each(['ADV-01.json', 'ADV-02.json'])(
    'flags the instruction override in %s',
    (file) => {
      expect(injectionSignal(textOf(file))).toBe(true);
    },
  );

  it.each(fixtureFiles.filter((file) => !ADVERSARIAL.test(file)))(
    'leaves the ordinary complaint in %s unflagged',
    (file) => {
      expect(injectionSignal(textOf(file))).toBe(false);
    },
  );

  it.each(['ADV-04.json', 'ADV-05.json', 'ADV-07.json', 'ADV-10.json'])(
    'leaves %s unflagged: its attack is not in the customer text',
    (file) => {
      expect(injectionSignal(textOf(file))).toBe(false);
    },
  );

  it("leaves ADV-06 unflagged: asking for another customer's data is no injection, G4 refuses it", () => {
    expect(injectionSignal(textOf('ADV-06.json'))).toBe(false);
  });

  // Known limits: demands phrased as a customer's request read like real
  // requests, so G2 and G5 contain them rather than this signal.
  it.each(['ADV-03.json', 'ADV-08.json', 'ADV-09.json'])(
    'misses the social-engineering demand in %s',
    (file) => {
      expect(injectionSignal(textOf(file))).toBe(false);
    },
  );
});
