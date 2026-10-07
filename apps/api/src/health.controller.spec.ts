import type { INestApplication, LoggerService } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { DATABASE_CLIENT } from './database/index.js';
import { HealthController } from './health.controller.js';

const SERVICE_UNAVAILABLE = 503;

let app: INestApplication | undefined;
let warnings: unknown[] = [];

const capture: LoggerService = {
  log: () => undefined,
  error: () => undefined,
  warn: (message: unknown) => {
    warnings.push(message);
  },
};

async function start(probe: () => Promise<unknown>): Promise<string> {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: DATABASE_CLIENT, useValue: probe }],
  }).compile();
  app = moduleRef.createNestApplication({ logger: capture });
  await app.listen(0, '127.0.0.1');
  return app.getUrl();
}

afterEach(async () => {
  await app?.close();
  app = undefined;
  warnings = [];
});

describe('GET /health', () => {
  it('answers 200 ok when the database answers', async () => {
    const base = await start(() => Promise.resolve([{ ok: 1 }]));
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('answers 503 when the database does not, so compose waits', async () => {
    const base = await start(() =>
      Promise.reject(new Error('password authentication failed')),
    );
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(SERVICE_UNAVAILABLE);
    expect(JSON.stringify(await response.json())).not.toContain('password');
  });

  it('logs why it answered 503, so an operator sees more than the status', async () => {
    const base = await start(() =>
      Promise.reject(new Error('connect ECONNREFUSED')),
    );
    await fetch(`${base}/health`);
    expect(warnings).toEqual([
      { event: 'health_db_unavailable', reason: 'connect ECONNREFUSED' },
    ]);
  });

  it('logs nothing while the database answers', async () => {
    const base = await start(() => Promise.resolve([{ ok: 1 }]));
    await fetch(`${base}/health`);
    expect(warnings).toEqual([]);
  });
});
