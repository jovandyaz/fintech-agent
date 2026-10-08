import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CONTAINER_START_MS,
  insertCase,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';
import { migrateDatabase } from './migrate.js';

const TABLES = [
  'action_executions',
  'agent_runs',
  'audit_log',
  'canary_cases',
  'cases',
  'policy_chunks',
  'proposed_actions',
  'resolutions',
  'run_steps',
  'security_events',
  'webhook_events',
];

let db: TestDatabase;
let sql: postgres.Sql;

beforeAll(async () => {
  db = await startTestDatabase();
  sql = postgres(db.ownerUrl, { max: 1 });
}, CONTAINER_START_MS);

afterAll(async () => {
  await sql.end();
  await db.stop();
});

describe('migrations (01 Data model)', () => {
  it('create every 01 table', async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name`;
    expect(rows.map((row) => row.table_name)).toEqual(TABLES);
  });

  it('can run again on a migrated database', async () => {
    await expect(migrateDatabase(db.ownerUrl)).resolves.toBeUndefined();
  });

  it('stems and unaccents Spanish so devolucion finds devolución', async () => {
    const [row] = await sql<{ hit: boolean }[]>`
      select to_tsvector('es_unaccent', 'Devolución de un SPEI')
        @@ to_tsquery('es_unaccent', 'devolucion') as hit`;
    expect(row?.hit).toBe(true);
  });

  it('weights a section heading above the body', async () => {
    await sql`
      insert into policy_chunks (id, doc_id, section, content, content_hash)
      values ('chunk_a', 'doc_a', 'Tiempos SPEI', 'texto general', 'h1'),
             ('chunk_b', 'doc_b', 'Otro tema', 'tiempos spei en el cuerpo', 'h2')`;
    const rows = await sql<{ id: string }[]>`
      select id from policy_chunks
      order by ts_rank_cd(tsv, to_tsquery('es_unaccent', 'tiempos & spei')) desc`;
    expect(rows.map((row) => row.id)).toEqual(['chunk_a', 'chunk_b']);
  });

  it('keeps one open proposal per case', async () => {
    await insertCase(sql, 'case_one');
    const proposal = (id: string) => sql`
      insert into proposed_actions (id, case_id, agent_type, agent_params, type, params, justification)
      values (${id}, 'case_one', 'none', '{}', 'none', '{}', 'x')`;
    await proposal('act_one');
    await expect(proposal('act_two')).rejects.toMatchObject({
      code: '23505',
    });
  });
});
