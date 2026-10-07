import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CONTAINER_START_MS,
  insertCase,
  startTestDatabase,
  type TestDatabase,
} from './database.js';

const ALERTS = readFileSync(
  resolve(import.meta.dirname, '../../../ops/alerts.sql'),
  'utf8',
);

function query(name: string): string {
  const block = ALERTS.split(/^-- name: /m).find((part) =>
    part.startsWith(`${name}\n`),
  );
  if (!block) throw new Error(`ops/alerts.sql has no query named ${name}`);
  return block.slice(block.indexOf('\n') + 1);
}

let db: TestDatabase;
let owner: postgres.Sql;
let sequence = 0;

async function decided(
  operator: string,
  status: 'canary_caught' | 'canary_missed' | 'rejected',
  minutesAgo: number,
): Promise<void> {
  sequence += 1;
  await owner`
    insert into proposed_actions (id, case_id, run_id, agent_type, agent_params, type, params,
      justification, status, is_canary, decided_by, decided_at, final_reply, reject_code)
    values (${`act_a${sequence}`}, 'case_al', 'run_al', 'none', '{}', 'none', '{}', 'x', ${status},
      ${status !== 'rejected'}, ${`operator:${operator}`}, now() - make_interval(mins => ${minutesAgo}),
      'listo', ${status === 'canary_missed' ? null : 'tone'})`;
}

beforeAll(async () => {
  db = await startTestDatabase();
  owner = postgres(db.ownerUrl, { max: 1, onnotice: () => undefined });
  await insertCase(owner, 'case_al');
  await owner`
    insert into agent_runs (id, case_id, variant, model, prompt_version)
    values ('run_al', 'case_al', 'v1', 'model', 'p1')`;
  await owner`alter table proposed_actions disable trigger enforce_transition_role`;
  for (let i = 0; i < 20; i += 1) await decided('ana', 'canary_caught', i);
  for (let i = 1; i < 20; i += 1) await decided('beto', 'canary_caught', i);
  await decided('beto', 'canary_missed', 0);
  for (let i = 0; i < 20; i += 1) await decided('caro', 'canary_caught', i);
  for (let i = 0; i < 5; i += 1)
    await decided('caro', 'canary_missed', 100 + i);
  await decided('dani', 'canary_caught', 1);
  await decided('dani', 'canary_missed', 2);
  for (let i = 0; i < 3; i += 1) await decided('eli', 'rejected', i);
  await owner`alter table proposed_actions enable trigger enforce_transition_role`;
}, CONTAINER_START_MS);

afterAll(async () => {
  await owner?.end();
  await db?.stop();
});

describe('ops/alerts.sql canary_catch_rate (01 Alerts)', () => {
  it('names each operator who missed a canary among their last 20', async () => {
    const rows = await owner.unsafe<
      { operator: string; caught: string; decided: string }[]
    >(query('canary_catch_rate'));
    expect(rows.map((row) => ({ ...row }))).toEqual([
      { operator: 'operator:beto', caught: '19', decided: '20' },
      { operator: 'operator:dani', caught: '1', decided: '2' },
    ]);
  });
});
