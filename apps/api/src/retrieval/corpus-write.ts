import { resolve } from 'node:path';

import postgres from 'postgres';

import { loadCorpus, type IngestedChunk } from './ingest.js';

/** `data/policies`, resolved from the source tree as the image lays it out. */
export const POLICIES_DIR = resolve(
  import.meta.dirname,
  '../../../../data/policies',
);

/** What `seed` logs once the corpus is written (02 G8: the seed prints quarantined chunks). */
export interface CorpusReport {
  chunks: number;
  quarantined: string[];
}

const rowOf = (sql: postgres.Sql, chunk: IngestedChunk) => ({
  id: chunk.id,
  doc_id: chunk.docId,
  section: chunk.section,
  content: chunk.content,
  keywords: chunk.keywords,
  state_rules: sql.json(chunk.stateRules),
  content_hash: chunk.contentHash,
  quarantined: chunk.quarantined,
});

/**
 * Ingests `dir` and replaces `policy_chunks` with it in one transaction, so
 * a run of `seed` never leaves a half-written or stale corpus. Throws
 * `CorpusRefusedError` before writing anything when the corpus is refused.
 */
export async function seedPolicies(
  ownerUrl: string,
  dir: string,
): Promise<CorpusReport> {
  const chunks = loadCorpus(dir);
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql.begin(async (tx) => {
      await tx`delete from policy_chunks`;
      await tx`insert into policy_chunks ${sql(chunks.map((chunk) => rowOf(sql, chunk)))}`;
    });
  } finally {
    await sql.end();
  }
  return {
    chunks: chunks.length,
    quarantined: chunks.filter((c) => c.quarantined).map(({ id }) => id),
  };
}
