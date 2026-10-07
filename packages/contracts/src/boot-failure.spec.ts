import { describe, expect, it } from 'vitest';

import { bootFailureLine } from './boot-failure.js';

const SECRET = 'ana-operator-dev-token-secret';

describe('bootFailureLine (02 G6 logs)', () => {
  it('is one JSON line naming the failure', () => {
    const line = bootFailureLine(new Error('CORE_READ_KEY is required'));
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toMatchObject({
      level: 'error',
      event: 'boot_failed',
      reason: 'CORE_READ_KEY is required',
    });
  });

  it('masks long digit runs and redacts credentials in the reason', () => {
    const reason = String(
      (
        JSON.parse(
          bootFailureLine(
            new Error(`bad CLABE 012180001234567891 with Bearer ${SECRET}`),
          ),
        ) as { reason: unknown }
      ).reason,
    );
    expect(reason).not.toMatch(/\d{8,}/);
    expect(reason).not.toContain(SECRET);
  });

  it('describes a non-Error throw without its contents', () => {
    expect(JSON.parse(bootFailureLine({ password: SECRET }))).toMatchObject({
      reason: '[Object]',
    });
  });
});
