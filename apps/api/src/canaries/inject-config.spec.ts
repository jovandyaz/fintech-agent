import { describe, expect, it } from 'vitest';

import { injectConfigOf } from './inject-config.js';

const HOST_URL = 'postgresql://copilot_api:pw@localhost:5433/copilot';
const COMPOSE_URL = 'postgresql://copilot_api:pw@db:5432/copilot';
const EXAMPLE = `API_DATABASE_URL=${HOST_URL}\nCANARY_SPREAD_MS=300000\n`;

describe('injectConfigOf', () => {
  it('takes its defaults from .env.example, so it runs from the host against the stack', () => {
    expect(injectConfigOf({}, EXAMPLE)).toEqual({
      databaseUrl: HOST_URL,
      spreadMs: 300_000,
    });
  });

  it('lets the environment override them', () => {
    expect(
      injectConfigOf(
        { API_DATABASE_URL: COMPOSE_URL, CANARY_SPREAD_MS: '0' },
        EXAMPLE,
      ),
    ).toEqual({ databaseUrl: COMPOSE_URL, spreadMs: 0 });
  });

  it('needs no .env.example where the environment names everything, as in the api container', () => {
    expect(
      injectConfigOf(
        { API_DATABASE_URL: COMPOSE_URL, CANARY_SPREAD_MS: '5' },
        null,
      ),
    ).toEqual({ databaseUrl: COMPOSE_URL, spreadMs: 5 });
  });

  it('refuses a negative spread or a database url that is not one', () => {
    expect(() => injectConfigOf({ CANARY_SPREAD_MS: '-1' }, EXAMPLE)).toThrow();
    expect(() =>
      injectConfigOf({ API_DATABASE_URL: 'not a url' }, EXAMPLE),
    ).toThrow();
  });
});
