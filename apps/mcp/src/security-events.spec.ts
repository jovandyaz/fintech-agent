import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { createPostgresSecurityEventSink } from './security-events.js';

const SHORT_TIMEOUT_MS = 20;

describe('Postgres security-event sink', () => {
  it('gives up on a database that never answers, so NOT_FOUND is not held back', async () => {
    const hanging = (() => new Promise(() => undefined)) as unknown as Sql;
    const sink = createPostgresSecurityEventSink(hanging, SHORT_TIMEOUT_MS);

    await expect(
      sink.record({
        kind: 'cross_customer_lookup',
        case_id: 'case_a1',
        run_id: 'run_a1',
        ref_masked: 'tx_f001',
      }),
    ).rejects.toThrow(/timed out/);
  });
});
