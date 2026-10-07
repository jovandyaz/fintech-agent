import { describe, expect, it } from 'vitest';

import { failedQuery, postgresError } from '../../../test/database-errors.js';
import { isUniqueViolation } from './unique-violation.js';

const CONSTRAINT = 'action_executions_pkey';

const violation = (code: string, constraint: string) =>
  postgresError({
    message: 'duplicate key value violates unique constraint',
    code,
    constraint_name: constraint,
  });

describe('isUniqueViolation', () => {
  it('finds a 23505 on the named constraint through Drizzle’s wrapping', () => {
    expect(
      isUniqueViolation(
        failedQuery(['act_x'], violation('23505', CONSTRAINT)),
        CONSTRAINT,
      ),
    ).toBe(true);
  });

  it('finds it on a bare driver error', () => {
    expect(isUniqueViolation(violation('23505', CONSTRAINT), CONSTRAINT)).toBe(
      true,
    );
  });

  it.each([
    ['another constraint', failedQuery([], violation('23505', 'other_unique'))],
    ['another code', failedQuery([], violation('23503', CONSTRAINT))],
    ['a plain error', new Error('duplicate key')],
    ['a string', '23505'],
    ['null', null],
  ])('is false for %s', (_, error) => {
    expect(isUniqueViolation(error, CONSTRAINT)).toBe(false);
  });
});
