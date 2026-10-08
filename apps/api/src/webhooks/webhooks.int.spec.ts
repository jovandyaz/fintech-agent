import {
  WEBHOOK_HEADERS,
  WEBHOOK_TOLERANCE_S as TOLERANCE_S,
  parseWebhookSecrets,
  signWebhook,
} from '@fintech-agent/contracts';
import type { INestApplication } from '@nestjs/common';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  HTTP,
  NO_CORE,
  WEBHOOK_SECRET,
  startApiApp,
} from '../../test/api-app.js';
import { JsonConsoleLogger } from '../common/logging/json-console-logger.js';
import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';

const [SECRET] = parseWebhookSecrets(WEBHOOK_SECRET);
const ROTATED_OUT = parseWebhookSecrets(
  `whsec_${Buffer.from('a-secret-already-rotated-out-0123').toString('base64')}`,
)[0]!;
const PAN = '4761343220832617';
const MAX_WEBHOOK_BODY_BYTES = 32 * 1024;
const CONCURRENT_DELIVERIES = 5;
const EIGHT_DIGITS = /\d{8,}/;

const warningsOnly = (): JsonConsoleLogger => {
  const logger = new JsonConsoleLogger();
  logger.setLogLevels(['warn', 'error']);
  return logger;
};

let testDb: TestDatabase;
let owner: postgres.Sql;
let app: INestApplication;
let base: string;
let sequence = 0;

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 2 });
  ({ app, base } = await startApiApp(testDb, NO_CORE, warningsOnly()));
}, CONTAINER_START_MS);

afterAll(async () => {
  await app?.close();
  await owner?.end();
  await testDb?.stop();
});

const nowS = () => Math.floor(Date.now() / 1000);

function eventOf(overrides: Record<string, unknown> = {}) {
  const n = ++sequence;
  return {
    event_id: `evt-wh-${n}`,
    ticket_id: `tkt-wh-${n}`,
    customer_id: 'cus_01',
    text: `Me cobraron con la tarjeta ${PAN} y no reconozco el cargo.`,
    created_at: '2026-10-07T15:00:00-06:00',
    ...overrides,
  };
}

function deliver(
  body: string,
  options: {
    id?: string;
    timestamp?: number;
    signature?: string;
    secret?: Buffer;
  } = {},
) {
  const id = options.id ?? (JSON.parse(body) as { event_id: string }).event_id;
  const timestamp = options.timestamp ?? nowS();
  const signature =
    options.signature ??
    signWebhook({ id, timestamp, body, secret: options.secret ?? SECRET! });
  return fetch(`${base}/webhooks/tickets`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [WEBHOOK_HEADERS.id]: id,
      [WEBHOOK_HEADERS.timestamp]: String(timestamp),
      [WEBHOOK_HEADERS.signature]: signature,
    },
    body,
  });
}

const casesFor = (ticketId: string) =>
  owner<
    {
      id: string;
      status: string;
      source: string;
      text_masked: string;
      folio: string;
    }[]
  >`select id, status, source, text_masked, folio from cases where ticket_id = ${ticketId}`;

describe('POST /webhooks/tickets (01 §Webhook and queue, 02 Required tests "Webhook")', () => {
  it('queues one case with a folio and acknowledges it at once with 202', async () => {
    const event = eventOf();
    const response = await deliver(JSON.stringify(event));
    expect(response.status).toBe(HTTP.accepted);
    const body = (await response.json()) as { case_id: string; folio: string };
    const [stored] = await casesFor(event.ticket_id);
    expect(body).toEqual({ case_id: stored!.id, folio: stored!.folio });
    expect(stored).toMatchObject({ status: 'queued', source: 'webhook' });
    const [acknowledged] = await owner<{ actor: string }[]>`
      select actor from audit_log where ref = ${stored!.id} and event = 'case.acknowledged'`;
    expect(acknowledged?.actor).toBe('intake:webhook');
  });

  it('stores only the masked text, never the raw card number (02 G6)', async () => {
    const event = eventOf();
    await deliver(JSON.stringify(event));
    const [stored] = await casesFor(event.ticket_id);
    expect(stored!.text_masked).not.toContain(PAN);
    const anywhere = await owner<{ hit: number }[]>`
      select count(*)::int as hit from cases where text_masked like ${`%${PAN}%`}`;
    expect(anywhere[0]?.hit).toBe(0);
  });

  it('answers the same event delivered twice with 200 and the original case', async () => {
    const body = JSON.stringify(eventOf());
    const first = (await (await deliver(body)).json()) as { case_id: string };
    const again = await deliver(body);
    expect(again.status).toBe(HTTP.ok);
    expect(await again.json()).toMatchObject({ case_id: first.case_id });
    expect(
      await casesFor((JSON.parse(body) as { ticket_id: string }).ticket_id),
    ).toHaveLength(1);
  });

  it('refuses the same event id with another body with 409', async () => {
    const event = eventOf();
    await deliver(JSON.stringify(event));
    const changed = await deliver(
      JSON.stringify({ ...event, text: 'Otro texto distinto.' }),
    );
    expect(changed.status).toBe(HTTP.conflict);
  });

  it('refuses a new event that reuses a ticket id with 409 and keeps no row of it', async () => {
    const event = eventOf();
    await deliver(JSON.stringify(event));
    const reusing = { ...eventOf(), ticket_id: event.ticket_id };
    const reused = await deliver(JSON.stringify(reusing));
    expect(reused.status).toBe(HTTP.conflict);
    expect(await casesFor(event.ticket_id)).toHaveLength(1);
    const [events] = await owner<{ n: number }[]>`
      select count(*)::int as n from webhook_events where event_id = ${reusing.event_id}`;
    expect(events?.n).toBe(0);
  });

  it('compares a repeat by its bytes: the same event re-serialized is a conflict', async () => {
    const event = eventOf();
    await deliver(JSON.stringify(event));
    const spaced = JSON.stringify(event, null, 2);
    expect((await deliver(spaced)).status).toBe(HTTP.conflict);
  });

  it('logs a conflict with its event id masked (01, 02 G6)', async () => {
    const written = vi.spyOn(process.stdout, 'write');
    try {
      const event = eventOf({ event_id: `evt-${PAN}` });
      await deliver(JSON.stringify(event));
      await deliver(JSON.stringify({ ...event, text: 'Otro texto.' }));
      const lines = written.mock.calls.map(([chunk]) => String(chunk));
      const conflict = lines.find((line) => line.includes('webhook_conflict'));
      expect(conflict).toBeDefined();
      expect(conflict).not.toMatch(EIGHT_DIGITS);
    } finally {
      written.mockRestore();
    }
  });

  it('opens one case for concurrent duplicate deliveries', async () => {
    const body = JSON.stringify(eventOf());
    const statuses = (
      await Promise.all(
        Array.from({ length: CONCURRENT_DELIVERIES }, () => deliver(body)),
      )
    ).map(({ status }) => status);
    expect(statuses.filter((status) => status === HTTP.accepted)).toHaveLength(
      1,
    );
    expect(statuses.filter((status) => status === HTTP.ok)).toHaveLength(
      CONCURRENT_DELIVERIES - 1,
    );
    expect(
      await casesFor((JSON.parse(body) as { ticket_id: string }).ticket_id),
    ).toHaveLength(1);
  });

  it.each([
    ['a bad signature', { signature: 'v1,AAAA' }],
    ['a timestamp past 5 minutes', { timestamp: nowS() - TOLERANCE_S - 1 }],
    ['a signature over the body re-serialized', { reserialize: true }],
  ])('refuses %s with 401 and opens no case', async (_, how) => {
    const event = eventOf();
    const body = JSON.stringify(event);
    const response =
      'reserialize' in how
        ? await fetch(`${base}/webhooks/tickets`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              [WEBHOOK_HEADERS.id]: event.event_id,
              [WEBHOOK_HEADERS.timestamp]: String(nowS()),
              [WEBHOOK_HEADERS.signature]: signWebhook({
                id: event.event_id,
                timestamp: nowS(),
                body,
                secret: SECRET!,
              }),
            },
            body: JSON.stringify(event, null, 2),
          })
        : await deliver(body, how);
    expect(response.status).toBe(HTTP.unauthorized);
    expect(await casesFor(event.ticket_id)).toHaveLength(0);
  });

  it('gives the same 401 whichever check failed, so a refusal leaks nothing', async () => {
    const answers = await Promise.all([
      deliver(JSON.stringify(eventOf()), { signature: 'v1,AAAA' }),
      deliver(JSON.stringify(eventOf()), {
        timestamp: nowS() - TOLERANCE_S - 1,
      }),
      fetch(`${base}/webhooks/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(eventOf()),
      }),
    ]);
    const bodies = await Promise.all(answers.map((answer) => answer.text()));
    expect(answers.map(({ status }) => status)).toEqual([
      HTTP.unauthorized,
      HTTP.unauthorized,
      HTTP.unauthorized,
    ]);
    expect(new Set(bodies).size).toBe(1);
  });

  it('refuses a signed delivery that is not JSON with 415, so the 32 KB JSON limit holds', async () => {
    const event = eventOf();
    const body = new URLSearchParams(event).toString();
    const timestamp = nowS();
    const response = await fetch(`${base}/webhooks/tickets`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        [WEBHOOK_HEADERS.id]: event.event_id,
        [WEBHOOK_HEADERS.timestamp]: String(timestamp),
        [WEBHOOK_HEADERS.signature]: signWebhook({
          id: event.event_id,
          timestamp,
          body,
          secret: SECRET!,
        }),
      },
      body,
    });
    expect(response.status).toBe(HTTP.unsupported);
    expect(await casesFor(event.ticket_id)).toHaveLength(0);
  });

  it('accepts a second valid signature in the header (rotation)', async () => {
    const body = JSON.stringify(eventOf());
    const id = (JSON.parse(body) as { event_id: string }).event_id;
    const timestamp = nowS();
    const signature = [ROTATED_OUT, SECRET!]
      .map((secret) => signWebhook({ id, timestamp, body, secret }))
      .join(' ');
    expect((await deliver(body, { timestamp, signature })).status).toBe(
      HTTP.accepted,
    );
  });

  it('refuses a body over 32 KB with 413', async () => {
    const event = eventOf({ text: 'x'.repeat(MAX_WEBHOOK_BODY_BYTES) });
    expect((await deliver(JSON.stringify(event))).status).toBe(HTTP.tooLarge);
  });

  it('refuses a webhook id that is not the event id with 400', async () => {
    const event = eventOf();
    const response = await deliver(JSON.stringify(event), { id: 'evt-other' });
    expect(response.status).toBe(HTTP.badRequest);
    expect(await casesFor(event.ticket_id)).toHaveLength(0);
  });

  it('refuses a signed body that is not a ticket event with 400', async () => {
    const response = await deliver(JSON.stringify({ event_id: 'evt-bad' }));
    expect(response.status).toBe(HTTP.badRequest);
  });
});
