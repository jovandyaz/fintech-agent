import { hasPii, maskJson, maskPii } from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import { isClean } from './is-clean.js';

const CLABE = '002010077777777771';
const UUID = '0b9d3c1e-1d3a-4b7e-9c1e-2f7a1b3c4d5e';
const EPOCH_MS = 1_760_000_000_000;
const REGISTRY_IDS = [
  'run_nzkjcsbskavm',
  'act_7a8b9c0d1e2f',
  'case_ab12',
  'tx_f002',
  'cus_01',
] as const;

// Every kind of value 02 G6 says must never reach a log or a trace.
const PLANTED = [
  'cuenta 12345678',
  'CLABE 002010077777777771',
  'tarjeta 4111 1111 1111 1111',
  'cel 55 1234 5678',
  'RFC GOPA741222HKG, CURP GOPA741222MDFGHJP1',
  'código 739104 y tarjeta 4761343220832617',
] as const;

describe('isClean, the PII sink oracle (02 G6, 01 §Observability)', () => {
  it.each(PLANTED)(
    'rests on a masker whose output is its own fixed point: %s',
    (text) => {
      const masked = maskPii(text);
      expect(maskPii(masked)).toBe(masked);
      const json = maskJson({ detail: text, nested: [{ text }] });
      expect(maskJson(json)).toEqual(json);
    },
  );

  it.each(PLANTED)(
    'flags the raw value and passes its masked form: %s',
    (text) => {
      expect(isClean(text)).toBe(false);
      expect(isClean({ detail: text })).toBe(false);
      expect(isClean(maskPii(text))).toBe(true);
      expect(isClean(maskJson({ detail: text }))).toBe(true);
    },
  );

  it('keeps the masker’s exempt runs and ids clean', () => {
    const exempt =
      'Folio AC-ZN83-H147, cargo de $1,299.50 el 2026-10-10T12:00:00.000Z con ••••1234';
    expect(isClean(exempt)).toBe(true);
    expect(
      isClean({
        run_id: '0b9d3c1e-1d3a-4b7e-9c1e-2f7a1b3c4d5e',
        action_id: 'act_yiinpjadrvfy',
        message: exempt,
        latency_ms: 1234,
      }),
    ).toBe(true);
  });

  it('does not flag text that masking only folds, such as an ellipsis', () => {
    expect(isClean('Revisamos tus dos cargos del 3 de octubre…')).toBe(true);
  });

  it('flags a long integer in JSON and treats null as clean', () => {
    expect(isClean({ ref: 12345678 })).toBe(false);
    expect(isClean(null)).toBe(true);
  });

  it('does not flag a JSON value that masking only folds, an ellipsis or a no-break space', () => {
    expect(isClean({ message: 'Revisamos tu caso…' })).toBe(true);
    expect(isClean({ message: 'Cargo de $1,299.50', nested: ['ok…'] })).toBe(
      true,
    );
  });

  it('flags a CLABE in a nested JSON value and in a key', () => {
    expect(isClean({ a: [{ b: { c: `CLABE ${CLABE}` } }] })).toBe(false);
    expect(isClean({ [`cuenta ${CLABE}`]: 'x' })).toBe(false);
  });

  it('passes registry ids under any key, as hasPii does', () => {
    for (const id of REGISTRY_IDS) {
      expect(hasPii(id)).toBe(false);
      expect(isClean({ action_id: id, note: id })).toBe(true);
    }
  });

  it('keeps what maskJson keeps verbatim, a UUID under an id key or an epoch under a time key, and nothing else', () => {
    expect(hasPii(UUID)).toBe(true);
    expect(isClean({ claim_id: UUID, started_ms: EPOCH_MS })).toBe(true);
    expect(isClean({ note: UUID })).toBe(false);
    expect(isClean({ count: EPOCH_MS })).toBe(false);
  });

  it.each([
    [{ otp: '123456' }],
    [{ pin: 4321 }],
    [{ password: 'hunter2' }],
    [['nip', '1234']],
    [{ name: 'cvv', value: '123' }],
  ])(
    'flags a raw auth factor that maskJson would replace whole: %j',
    (value) => {
      expect(isClean(value)).toBe(false);
    },
  );

  it.each([
    [{ otp: '[factor]' }],
    [['nip', '[factor]']],
    [{ token: '[redacted]' }],
  ])(
    'passes a factor slot that already holds a marker, as the masker or the logger wrote it: %j',
    (value) => {
      expect(isClean(value)).toBe(true);
    },
  );

  it('fails closed on a value the masker cannot read', () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error('hostile');
        },
      },
    );
    expect(isClean(hostile)).toBe(false);
  });
});
