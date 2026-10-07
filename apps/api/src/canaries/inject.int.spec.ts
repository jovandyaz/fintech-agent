import { isFolio, maskPii, registryIdPattern } from '@fintech-agent/contracts';
import type { INestApplication } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ANA, NO_CORE, seedProposal, startApiApp } from '../../test/api-app.js';
import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';
import * as schema from '../database/schema.js';
import { reviewTierOf } from '../cases/review-tier.js';
import { injectCanaries } from './inject.js';
import { CANARY_DEFECTS, CANARY_TEMPLATES } from './templates.js';

let db: TestDatabase;
let owner: postgres.Sql;
let api: postgres.Sql;
let app: INestApplication;
let base: string;

const inject = () =>
  injectCanaries(drizzle({ client: api, schema }), { now: () => new Date() });

beforeAll(async () => {
  db = await startTestDatabase();
  owner = postgres(db.ownerUrl, { max: 1, onnotice: () => undefined });
  api = postgres(db.urlFor('copilot_api'), { max: 1 });
  ({ app, base } = await startApiApp(db, NO_CORE));
}, CONTAINER_START_MS);

afterAll(async () => {
  await app?.close();
  await api?.end();
  await owner?.end();
  await db?.stop();
});

describe('canary:inject (02 G3)', () => {
  it('refuses to inject before a real run exists to mirror', async () => {
    await expect(inject()).rejects.toThrow(/no succeeded run/);
  });

  it('injects one canary per defect, each on its own case and run, mirroring the last real run', async () => {
    await seedProposal(owner, 'real1');
    await owner`
      update agent_runs set status = 'succeeded', stop_reason = 'completed', input_tokens = 5120,
        output_tokens = 640, cost_usd = '0.031200', latency_ms = 18000, finished_at = now()
      where id = 'run_real1'`;

    const actionIds = await inject();
    expect(actionIds).toHaveLength(CANARY_DEFECTS.length);

    const rows = await owner<
      {
        action_id: string;
        case_id: string;
        run_id: string;
        is_canary: boolean;
        status: string;
        type: string;
        case_status: string;
        source: string;
        review_tier: string;
        flags: unknown;
        received_at: Date;
        started_at: Date;
        finished_at: Date;
        latency_ms: number;
        folio: string;
        ticket_id: string;
        text_masked: string;
        customer_id: string;
        category: string;
        variant: string;
        model: string;
        prompt_version: string;
        run_status: string;
        input_tokens: number;
        draft_reply: string;
      }[]
    >`
      select a.id as action_id, c.id as case_id, r.id as run_id, a.is_canary, a.status, a.type,
        c.status as case_status, c.source, c.review_tier, c.flags, c.folio, c.ticket_id,
        c.received_at, r.started_at, r.finished_at, r.latency_ms,
        c.text_masked, c.customer_id, c.category, r.variant, r.model, r.prompt_version,
        r.status as run_status, r.input_tokens, s.draft_reply
      from proposed_actions a
      join cases c on c.id = a.case_id
      join agent_runs r on r.id = a.run_id
      join resolutions s on s.run_id = r.id
      where a.id in ${owner(actionIds)}
      order by a.proposed_at, a.id`;

    expect(new Set(rows.map(({ case_id }) => case_id)).size).toBe(rows.length);
    expect(new Set(rows.map(({ run_id }) => run_id)).size).toBe(rows.length);
    for (const row of rows) {
      const template = CANARY_TEMPLATES.find(
        ({ seed }) =>
          seed.draftReply === row.draft_reply &&
          seed.category === row.category &&
          seed.action.type === row.type,
      );
      expect(template).toBeDefined();
      expect(row).toMatchObject({
        is_canary: true,
        status: 'proposed',
        case_status: 'needs_review',
        source: 'webhook',
        review_tier: reviewTierOf(
          template?.seed.action.type ?? 'none',
          template?.seed.flags ?? [],
        ),
        flags: template?.seed.flags,
        customer_id: template?.seed.customerId,
        text_masked: maskPii(template?.seed.text ?? ''),
        variant: 'v1',
        model: 'model',
        prompt_version: 'p1',
        run_status: 'succeeded',
        input_tokens: 5120,
      });
      expect(row.finished_at.getTime() - row.started_at.getTime()).toBe(
        row.latency_ms,
      );
      expect(row.received_at.getTime()).toBeLessThan(row.started_at.getTime());
      expect(isFolio(row.folio)).toBe(true);
      expect(row.case_id).toMatch(registryIdPattern('case'));
      expect(row.run_id).toMatch(registryIdPattern('run'));
      expect(row.action_id).toMatch(registryIdPattern('act'));
      expect(row.ticket_id).not.toMatch(/canar/i);
    }
  });

  it('injects all canaries or none', async () => {
    const [count] = await owner<{ n: string }[]>`
      select count(*) as n from proposed_actions where is_canary`;
    const broken = [
      ...CANARY_TEMPLATES.slice(0, 3),
      {
        defect: 'cold_tone',
        seed: { ...CANARY_TEMPLATES[0]!.seed, category: 'not_a_category' },
      },
    ] as unknown as typeof CANARY_TEMPLATES;
    await expect(
      injectCanaries(
        drizzle({ client: api, schema }),
        { now: () => new Date() },
        broken,
      ),
    ).rejects.toThrow();
    const [after] = await owner<{ n: string }[]>`
      select count(*) as n from proposed_actions where is_canary`;
    expect(after?.n).toBe(count?.n);
  });

  it('decides an injected canary like any proposal, and never as approved', async () => {
    const [actionId] = await inject();
    const response = await fetch(`${base}/actions/${actionId}/decision`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ANA}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        decision: 'approve',
        final_reply: 'Hola, ya registramos tu aclaración.',
        acknowledged_flags: CANARY_TEMPLATES[0]?.seed.flags,
        reviewed_transaction_ids:
          CANARY_TEMPLATES[0]?.seed.action.transaction_ids,
      }),
    });
    expect(await response.json()).toEqual({
      action_id: actionId,
      status: 'canary_missed',
    });
  });
});
