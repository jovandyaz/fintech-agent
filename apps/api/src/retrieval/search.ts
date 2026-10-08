import type { PolicyChunk } from '@fintech-agent/contracts';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';

import type { PolicyCatalogEntry, Retrieval } from '../agent/core/tools.js';
import type { Database } from '../database/index.js';
import { SEARCH_CONFIG, policyChunks } from '../database/schema.js';
import type { PolicyManifest } from './ingest.js';

// plainto_tsquery ANDs every lexeme, which misses "cuánto tarda un SPEI en
// llegar" against "Tiempos SPEI" (01 §Retrieval); its output joins lexemes
// with " & " only, so swapping that for " | " ORs them. Input operators stay
// text, since plainto_tsquery parses none.
// Unaccenting before stemming leaves Snowball's accented suffixes ("-ción")
// unmatched, so "devoluciones" stems to `devolu` and "devolución" to
// `devolucion`; a prefix match on every lexeme of at least 5 characters joins
// them. A quote inside a lexeme is written '' in tsquery text, so the pattern
// takes it whole.
// Postgres text cannot hold a NUL; the driver would fail the whole search,
// and dropping it would fuse the words around it.
const NUL = /\0/g;
const MIN_PREFIX_LEXEME_CHARS = 5;
const QUOTED_LEXEME = `'((?:[^']|''){${MIN_PREFIX_LEXEME_CHARS},})'`;
const AS_PREFIX = "'\\1':*";
const anyLexemeTextOf = (query: string): SQL =>
  sql`replace(plainto_tsquery(${SEARCH_CONFIG}, ${query})::text, ' & ', ' | ')`;
const exactLexemesOf = (query: string): SQL =>
  sql`${anyLexemeTextOf(query)}::tsquery`;
const prefixLexemesOf = (query: string): SQL =>
  sql`regexp_replace(${anyLexemeTextOf(query)}, ${QUOTED_LEXEME}, ${AS_PREFIX}, 'g')::tsquery`;

/** The `search_policies` catalog: id and title of every manifest doc (01 §Tools). */
export function policyCatalog(manifest: PolicyManifest): PolicyCatalogEntry[] {
  return manifest.docs.map(({ doc_id, title }) => ({ doc_id, title }));
}

/**
 * Full-text search over the non-quarantined corpus (01 §Retrieval, 02 G8):
 * any of the query's lexemes under `es_unaccent` (long ones also as a prefix),
 * ranked by `ts_rank_cd` of the exact lexemes, then of the prefixes, over
 * the weighted heading, keywords and body, optionally within one doc.
 */
export function createRetrieval(
  db: Database,
  catalog: readonly PolicyCatalogEntry[],
): Retrieval {
  return {
    catalog,
    search: async ({ query, k, doc_id }): Promise<PolicyChunk[]> => {
      const text = query.replace(NUL, ' ');
      const prefixed = prefixLexemesOf(text);
      const exact = exactLexemesOf(text);
      return db
        .select({
          chunk_id: policyChunks.id,
          doc_id: policyChunks.docId,
          section: policyChunks.section,
          content: policyChunks.content,
        })
        .from(policyChunks)
        .where(
          and(
            eq(policyChunks.quarantined, false),
            sql`${policyChunks.tsv} @@ ${prefixed}`,
            doc_id === undefined ? undefined : eq(policyChunks.docId, doc_id),
          ),
        )
        .orderBy(
          // A prefix widens what matches, never what ranks first: "compr:*"
          // would put "comprobante" above the chunk that says "compra".
          sql`ts_rank_cd(${policyChunks.tsv}, ${exact}) desc`,
          sql`ts_rank_cd(${policyChunks.tsv}, ${prefixed}) desc`,
          asc(policyChunks.id),
        )
        .limit(k);
    },
  };
}
