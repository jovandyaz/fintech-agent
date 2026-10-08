import { drizzle } from 'drizzle-orm/postgres-js';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';
import { corpusStateRules } from '../agent/core/corpus.js';
import * as schema from '../database/schema.js';
import { POLICIES_DIR, seedPolicies } from './corpus-write.js';
import { CorpusRefusedError, loadCorpus } from './ingest.js';

let testDb: TestDatabase;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 2 });
}, CONTAINER_START_MS);

afterAll(async () => {
  await owner?.end();
  await testDb?.stop();
});

const rows = () =>
  owner<{ id: string; quarantined: boolean; tsv: string | null }[]>`
    select id, quarantined, tsv::text as tsv from policy_chunks order by id`;

describe('seedPolicies (04 Step 5: ingestion runs inside seed)', () => {
  it('writes every chunk of the corpus and reports the quarantined ones', async () => {
    const report = await seedPolicies(testDb.ownerUrl, POLICIES_DIR);
    const written = await rows();
    expect(written.map(({ id }) => id)).toEqual(
      loadCorpus(POLICIES_DIR)
        .map(({ id }) => id)
        .sort(),
    );
    expect(report).toEqual({
      chunks: written.length,
      quarantined: written.filter((r) => r.quarantined).map(({ id }) => id),
    });
    expect(report.quarantined).toEqual(['chunk_p09s1']);
    expect(written.every(({ tsv }) => tsv !== null && tsv !== '')).toBe(true);
  });

  it('replaces the corpus when run again, never duplicating it', async () => {
    await owner`insert into policy_chunks (id, doc_id, section, content, content_hash)
      values ('chunk_stale', 'pol-99', 'Vieja', 'Texto viejo', 'x')`;
    await seedPolicies(testDb.ownerUrl, POLICIES_DIR);
    const ids = (await rows()).map(({ id }) => id);
    expect(ids).not.toContain('chunk_stale');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves the stored corpus untouched when the new one is refused', async () => {
    await seedPolicies(testDb.ownerUrl, POLICIES_DIR);
    const before = await rows();
    const tampered = mkdtempSync(join(tmpdir(), 'policies-'));
    try {
      cpSync(POLICIES_DIR, tampered, { recursive: true });
      writeFileSync(join(tampered, '99-sin-manifiesto.md'), '## A\n\nB.\n');
      await expect(
        seedPolicies(testDb.ownerUrl, tampered),
      ).rejects.toBeInstanceOf(CorpusRefusedError);
    } finally {
      rmSync(tampered, { recursive: true, force: true });
    }
    expect(await rows()).toEqual(before);
  });

  it('stores the state rules Persist reads, parsed (CONFLICT-01)', async () => {
    await seedPolicies(testDb.ownerUrl, POLICIES_DIR);
    const apiSql = postgres(testDb.urlFor('copilot_api'), { max: 1 });
    try {
      const rules = await corpusStateRules(drizzle({ client: apiSql, schema }));
      expect(
        rules.flatMap(({ chunk_id, rules: list }) =>
          list.map(({ id }) => `${chunk_id}:${id}`),
        ),
      ).toEqual(['chunk_p02s2:return_credit_same_day']);
    } finally {
      await apiSql.end();
    }
  });
});
