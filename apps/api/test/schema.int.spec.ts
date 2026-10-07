import { CASE_FLAGS } from '@fintech-agent/contracts';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CONTAINER_START_MS,
  insertCase,
  startTestDatabase,
  type TestDatabase,
} from './database.js';

const OK = 'ok';
const CHECK_VIOLATION = '23514';

let db: TestDatabase;
let owner: postgres.Sql;
let api: postgres.Sql;

async function outcome(query: Promise<unknown>): Promise<string> {
  try {
    await query;
    return OK;
  } catch (error) {
    return error instanceof postgres.PostgresError ? error.code : 'other';
  }
}

async function constraintFlags(table: string): Promise<string[]> {
  const [row] = await owner<{ definition: string }[]>`
    select pg_get_constraintdef(c.oid) as definition
    from pg_constraint c join pg_class t on t.oid = c.conrelid
    where t.relname = ${table} and c.contype = 'c' and c.conname like '%flags%'`;
  return [...(row?.definition ?? '').matchAll(/"(\w+)"/g)].map(
    ([, flag]) => flag ?? '',
  );
}

beforeAll(async () => {
  db = await startTestDatabase();
  owner = postgres(db.ownerUrl, { max: 1, onnotice: () => undefined });
  api = postgres(db.urlFor('copilot_api'), { max: 1 });
  await insertCase(owner, 'case_f1');
  await owner`
    insert into agent_runs (id, case_id, variant, model, prompt_version)
    values ('run_f1', 'case_f1', 'v', 'm', 'p1')`;
  await owner`
    insert into proposed_actions (id, case_id, run_id, agent_type, agent_params, type, params, justification)
    values ('act_f1', 'case_f1', 'run_f1', 'none', '{}', 'none', '{}', 'x')`;
}, CONTAINER_START_MS);

afterAll(async () => {
  await api?.end();
  await owner?.end();
  await db?.stop();
});

describe('cases.flags is the closed set of 01 in the database', () => {
  it.each(CASE_FLAGS)('accepts %s', async (flag) => {
    expect(
      await outcome(
        api`update cases set flags = ${api.json([flag])} where id = 'case_f1'`,
      ),
    ).toBe(OK);
  });

  it.each([['["unknown"]'], ['{}'], ['"injection_signal"']])(
    'refuses %s',
    async (value) => {
      expect(
        await outcome(
          api`update cases set flags = ${value}::jsonb where id = 'case_f1'`,
        ),
      ).toBe(CHECK_VIOLATION);
    },
  );

  it('lists exactly CASE_FLAGS, so contracts and the database cannot drift', async () => {
    expect(await constraintFlags('cases')).toEqual([...CASE_FLAGS]);
  });
});

describe('proposed_actions.acknowledged_flags is the same closed set', () => {
  it('refuses a flag outside it', async () => {
    await owner`alter table proposed_actions disable trigger enforce_transition_role`;
    try {
      expect(
        await outcome(
          owner`update proposed_actions set acknowledged_flags = '["looks_fine"]' where id = 'act_f1'`,
        ),
      ).toBe(CHECK_VIOLATION);
      expect(
        await outcome(
          owner`update proposed_actions set acknowledged_flags = '["fallback"]' where id = 'act_f1'`,
        ),
      ).toBe(OK);
    } finally {
      await owner`alter table proposed_actions enable trigger enforce_transition_role`;
    }
  });

  it('lists exactly CASE_FLAGS', async () => {
    expect(await constraintFlags('proposed_actions')).toEqual([...CASE_FLAGS]);
  });
});
