import { describe, expect, it } from 'vitest';

import { scanTracesConfigOf } from './scan-traces-config.js';

const NOW = new Date('2026-10-10T12:00:00.000Z');
const EXAMPLE_URL =
  'postgresql://copilot_api:dev-api-db-password@localhost:5433/copilot';
const ENV_EXAMPLE = `# dev defaults\nAPI_DATABASE_URL=${EXAMPLE_URL}\n`;
const STACK_URL = 'postgresql://copilot_api:stack-password@db:5432/copilot';
const USAGE = 'ops:scan-traces takes only --since <ISO instant>';
const BAD_SINCE = '--since takes an ISO instant with Z or an offset';
const BAD_URL = 'API_DATABASE_URL must be a URL';

describe('scanTracesConfigOf', () => {
  it('scans the last 24 hours of the .env.example database by default', () => {
    expect(scanTracesConfigOf({}, ENV_EXAMPLE, [], NOW)).toEqual({
      databaseUrl: EXAMPLE_URL,
      since: new Date('2026-10-09T12:00:00.000Z'),
    });
  });

  it('takes --since and the environment over the defaults', () => {
    expect(
      scanTracesConfigOf(
        { API_DATABASE_URL: STACK_URL },
        ENV_EXAMPLE,
        ['--since', '2026-10-01T06:00:00-06:00'],
        NOW,
      ),
    ).toEqual({
      databaseUrl: STACK_URL,
      since: new Date('2026-10-01T12:00:00.000Z'),
    });
  });

  it('reads the environment alone where there is no .env.example, as in the api image', () => {
    expect(
      scanTracesConfigOf({ API_DATABASE_URL: STACK_URL }, null, [], NOW)
        .databaseUrl,
    ).toBe(STACK_URL);
  });

  it.each([
    [['--since', 'yesterday'], BAD_SINCE],
    [['--since', '2026-10-09'], BAD_SINCE],
    [['--since', '2026-10-09T00:00:00'], BAD_SINCE],
    [['--until', '2026-10-09T00:00:00Z'], USAGE],
    [['--since'], USAGE],
    [['2026-10-09T00:00:00Z'], USAGE],
  ])('refuses %j with a short message', (argv, message) => {
    expect(() => scanTracesConfigOf({}, ENV_EXAMPLE, argv, NOW)).toThrow(
      new Error(message),
    );
  });

  it('refuses a malformed database url with a short message', () => {
    expect(() =>
      scanTracesConfigOf({ API_DATABASE_URL: 'not a url' }, null, [], NOW),
    ).toThrow(new Error(BAD_URL));
  });
});
