import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

import {
  WEBHOOK_HEADERS,
  WebhookEventSchema,
  parseWebhookSecrets,
  signWebhook,
} from '@fintech-agent/contracts';
import { z } from 'zod';

// The id becomes a file path, so nothing but a fixture name is ever opened.
const FIXTURE_ID = /^[A-Z]+(?:-[A-Z]+)*-\d{2}$/;
const MS_PER_SECOND = 1000;
const LOCAL_API = 'http://localhost';

const DemoEnvSchema = z.object({
  API_PORT: z.coerce.number().int().positive(),
  WEBHOOK_SECRET: z.string().min(1),
});

/** Where `pnpm demo:post` sends fixtures and the secret it signs them with. */
export interface DemoConfig {
  apiUrl: string;
  secret: Buffer;
}

/**
 * The demo's settings: the environment over the dev defaults in
 * `.env.example`, so the default secret is written in one place. Throws on a
 * malformed port or secret.
 */
export function demoConfigOf(
  env: NodeJS.ProcessEnv,
  envExample: string,
): DemoConfig {
  const { API_PORT, WEBHOOK_SECRET } = DemoEnvSchema.parse({
    ...parseEnv(envExample),
    ...env,
  });
  const [secret] = parseWebhookSecrets(WEBHOOK_SECRET);
  return { apiUrl: `${LOCAL_API}:${API_PORT}`, secret };
}

/** How the API answered one fixture. */
export interface PostedFixture {
  id: string;
  status: number;
  ok: boolean;
  body: unknown;
}

/**
 * Signs each fixture's bytes as they are and posts it to the ticket webhook,
 * one after another. Every fixture is read and checked before the first post,
 * so a bad id sends nothing.
 */
export async function postFixtures(input: {
  ids: readonly string[];
  apiUrl: string;
  secret: Buffer;
  fixturesDir: string;
  now: () => Date;
}): Promise<PostedFixture[]> {
  const fixtures = await Promise.all(
    input.ids.map((id) => readFixture(input.fixturesDir, id)),
  );
  const posted: PostedFixture[] = [];
  for (const { id, eventId, body } of fixtures) {
    const timestamp = Math.floor(input.now().getTime() / MS_PER_SECOND);
    const response = await fetch(`${input.apiUrl}/webhooks/tickets`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [WEBHOOK_HEADERS.id]: eventId,
        [WEBHOOK_HEADERS.timestamp]: String(timestamp),
        [WEBHOOK_HEADERS.signature]: signWebhook({
          id: eventId,
          timestamp,
          body,
          secret: input.secret,
        }),
      },
      body,
    });
    posted.push({
      id,
      status: response.status,
      ok: response.ok,
      body: await response.json(),
    });
  }
  return posted;
}

async function readFixture(
  dir: string,
  id: string,
): Promise<{ id: string; eventId: string; body: string }> {
  if (!FIXTURE_ID.test(id)) throw new Error(`not a fixture id: ${id}`);
  const body = await readFile(join(dir, `${id}.json`), 'utf8');
  const { event_id } = WebhookEventSchema.parse(JSON.parse(body));
  return { id, eventId: event_id, body };
}
