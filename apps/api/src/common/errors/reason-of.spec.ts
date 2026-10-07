import { describe, expect, it } from 'vitest';

import { failedQuery, postgresError } from '../../../test/database-errors.js';
import { reasonOf } from './reason-of.js';

const SECRET_PARAM = 'sentinel-customer-secret';

describe('reasonOf', () => {
  it('reads the message of an Error', () => {
    expect(reasonOf(new TypeError('connection reset'))).toBe(
      'connection reset',
    );
  });

  it('stringifies a thrown primitive', () => {
    expect(reasonOf('timeout')).toBe('timeout');
    expect(reasonOf(undefined)).toBe('undefined');
    expect(reasonOf(null)).toBe('null');
    expect(reasonOf(42)).toBe('42');
    expect(reasonOf(Symbol('probe'))).toBe('Symbol(probe)');
  });

  it('names a thrown object by its class, never by what it holds', () => {
    class Rejection {
      readonly secret = SECRET_PARAM;
    }

    expect(reasonOf({ params: [SECRET_PARAM] })).toBe('[Object]');
    expect(reasonOf(new Rejection())).toBe('[Rejection]');
    expect(reasonOf([SECRET_PARAM])).toBe('[Array]');
  });

  it('names a thrown object that has no class without throwing', () => {
    const bare = Object.assign(Object.create(null) as object, {
      secret: SECRET_PARAM,
    });

    expect(reasonOf(bare)).toBe('[unknown]');
  });

  it('names an object whose class cannot even be read without throwing', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(reasonOf(proxy)).toBe('[unknown]');
  });

  it('describes a failed query by its diagnostics, never by its bound parameters', () => {
    const rejected = failedQuery(
      ['someone@example.com', SECRET_PARAM],
      postgresError({
        message:
          'duplicate key value violates unique constraint "cases_ticket_id_unique"',
        code: '23505',
        table_name: 'cases',
        constraint_name: 'cases_ticket_id_unique',
        detail: `Key (email)=(someone@example.com) already exists.`,
      }),
    );

    const reason = reasonOf(rejected);

    expect(reason).toBe(
      'DrizzleQueryError (failureCategory=unique_violation, sqlState=23505, table=cases, constraint=cases_ticket_id_unique)',
    );
    expect(reason).not.toContain(SECRET_PARAM);
    expect(reason).not.toContain('someone@example.com');
  });

  it('keeps the input a raw Postgres error echoes out of its reason', () => {
    const rejectedInput = postgresError({
      message: `invalid input syntax for type uuid: "${SECRET_PARAM}"`,
      code: '22P02',
    });

    expect(reasonOf(rejectedInput)).toBe(
      'PostgresError (failureCategory=unclassified, sqlState=22P02)',
    );
  });

  it('describes an error wrapping a failed query by that query, never by its own message or the parameters', () => {
    const wrapped = new Error(`Lookup failed: ${SECRET_PARAM}`, {
      cause: failedQuery([SECRET_PARAM]),
    });

    expect(reasonOf(wrapped)).toBe(
      'Error (failureCategory=transaction_conflict, sqlState=40P01)',
    );
  });
});
