import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CONTAINER_START_MS,
  startTestDatabase,
  type TestDatabase,
} from '../../test/database.js';
import type { Retrieval } from '../agent/core/tools.js';
import * as schema from '../database/schema.js';
import { seedPolicies } from './corpus-write.js';
import { POLICIES_DIR, loadManifest } from './ingest.js';
import { createRetrieval, policyCatalog } from './search.js';

// 04 Step 5 "Done when": recall@4 ≥ 0.9 on the paraphrases.
const MIN_RECALL_AT_4 = 0.9;
const K = 4;

// Customer phrasings written apart from the policy text and the manifest
// keywords (the first is 04's own example), each with the doc a correct
// answer must cite.
const PARAPHRASES: readonly (readonly [string, string])[] = [
  ['cuánto tarda un SPEI en llegar', 'pol-01'],
  ['mandé una transferencia y a mi amigo todavía no le llega', 'pol-01'],
  ['mi transferencia sigue pendiente desde hace dos horas', 'pol-01'],
  ['por qué me retienen el SPEI que envié', 'pol-01'],
  ['me regresaron una transferencia, ¿por qué?', 'pol-02'],
  [
    'necesito el comprobante de la transferencia para el beneficiario',
    'pol-02',
  ],
  ['la transferencia rebotó porque la cuenta no existe', 'pol-02'],
  ['devolucion de un spei', 'pol-02'],
  ['tengo dos devoluciones y no veo el dinero', 'pol-02'],
  ['quiero presentar una aclaración', 'pol-03'],
  ['en cuánto tiempo me contestan la reclamación', 'pol-03'],
  ['¿puedo quejarme ante la CONDUSEF?', 'pol-03'],
  ['no reconozco un cargo de mi tarjeta', 'pol-04'],
  ['me cobraron algo que yo no compré', 'pol-04'],
  ['qué es este movimiento de mi tarjeta que yo no hice', 'pol-04'],
  ['en cuántos días me reponen el dinero de una compra ajena', 'pol-04'],
  ['en el súper no pasó mi pago con tarjeta', 'pol-05'],
  ['por qué no pasó mi compra en línea', 'pol-05'],
  ['mi plástico ya caducó y no me deja pagar', 'pol-05'],
  ['por qué está suspendida mi tarjeta si no hice nada', 'pol-06'],
  ['aparecen muchas compras chiquitas de la misma tienda', 'pol-06'],
  ['me quisieron depositar y el dinero no entró a mi cuenta', 'pol-07'],
  ['cómo subo de nivel mi cuenta', 'pol-07'],
  ['me están pidiendo mi NIP por teléfono, ¿es normal?', 'pol-08'],
  ['quiero ver los movimientos de la cuenta de mi esposa', 'pol-08'],
];

// Written before the manifest keywords were last edited and never used to
// choose them, so they measure whether the keywords generalize.
const HELD_OUT: readonly (readonly [string, string])[] = [
  ['cuánto se tarda en reflejar una transferencia', 'pol-01'],
  ['me cobraron en una app que nunca usé', 'pol-04'],
  ['el pago con mi tarjeta fue declinado en la gasolinera', 'pol-05'],
  ['alguien está usando mi tarjeta sin permiso', 'pol-06'],
  ['cuál es el máximo que puedo recibir al mes', 'pol-07'],
];

let testDb: TestDatabase;
let apiSql: postgres.Sql;
let retrieval: Retrieval;

beforeAll(async () => {
  testDb = await startTestDatabase();
  await seedPolicies(testDb.ownerUrl, POLICIES_DIR);
  apiSql = postgres(testDb.urlFor('copilot_api'), { max: 2 });
  retrieval = createRetrieval(
    drizzle({ client: apiSql, schema }),
    policyCatalog(loadManifest(POLICIES_DIR)),
  );
}, CONTAINER_START_MS);

afterAll(async () => {
  await apiSql?.end();
  await testDb?.stop();
});

const docsFor = async (query: string, docId?: string): Promise<string[]> =>
  (
    await retrieval.search({
      query,
      k: K,
      ...(docId === undefined ? {} : { doc_id: docId }),
    })
  ).map(({ doc_id }) => doc_id);

describe('createRetrieval (01 §Retrieval)', () => {
  it('finds the right policy in the top 4 for at least 90% of customer phrasings', async () => {
    const misses: string[] = [];
    for (const [query, docId] of PARAPHRASES) {
      if (!(await docsFor(query)).includes(docId)) misses.push(query);
    }
    expect(misses.length / PARAPHRASES.length).toBeLessThanOrEqual(
      1 - MIN_RECALL_AT_4,
    );
  });

  it('finds the right policy in the top 4 for held-out phrasings too', async () => {
    const misses: string[] = [];
    for (const [query, docId] of HELD_OUT) {
      if (!(await docsFor(query)).includes(docId)) misses.push(query);
    }
    expect(misses.length / HELD_OUT.length).toBeLessThanOrEqual(
      1 - MIN_RECALL_AT_4,
    );
  });

  it('returns the SPEI-times doc first for "cuánto tarda un SPEI en llegar"', async () => {
    expect((await docsFor('cuánto tarda un SPEI en llegar'))[0]).toBe('pol-01');
  });

  it('finds "devolución" from the unaccented "devolucion", singular and plural', async () => {
    for (const query of ['devolucion', 'devoluciones', 'devolución']) {
      expect(await docsFor(query)).toContain('pol-02');
    }
  });

  it('never returns quarantined policy 09, even for its own words or its doc_id (ADV-04)', async () => {
    expect(
      await docsFor('SPEI enviado que el beneficiario no recibió'),
    ).not.toContain('pol-09');
    expect(await docsFor('SPEI enviado', 'pol-09')).toEqual([]);
  });

  it('returns policy 09b, the subtle rule that passes the scan (ADV-05)', async () => {
    expect(
      await docsFor('me rechazaron la tarjeta en una tienda de conveniencia'),
    ).toContain('pol-09b');
  });

  it('narrows to one policy with doc_id and honors k', async () => {
    const chunks = await retrieval.search({
      query: 'plazo dictamen folio aclaración',
      k: 1,
      doc_id: 'pol-03',
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.doc_id).toBe('pol-03');
  });

  it('returns the stored normalized chunk shape', async () => {
    const [chunk] = await retrieval.search({ query: 'CONDUSEF', k: 1 });
    expect(Object.keys(chunk ?? {}).sort()).toEqual([
      'chunk_id',
      'content',
      'doc_id',
      'section',
    ]);
  });

  it.each([
    ['only stopwords', 'de la el'],
    ['only punctuation', '¿?¡!'],
  ])('returns nothing, without an error, for %s', async (_, query) => {
    expect(await docsFor(query)).toEqual([]);
  });

  it.each([
    ['tsquery operators', "spei & devolucion | !cargo:* <-> ('x')"],
    ['a quote inside a URL', "devolucion en http://banco.mx/o'higgins"],
    ['a NUL byte between words', `spei${String.fromCharCode(0)}devolucion`],
    ['quotes and backslashes', "devolucion o'reilly \\ \" ' --"],
  ])('reads %s in a query as text, words included', async (_, query) => {
    expect(await docsFor(query)).toContain('pol-02');
  });

  it.each([
    ['por qué no pasó mi compra en línea', 'pol-05'],
    ['me cobraron algo que yo no compré', 'pol-04'],
  ])(
    'ranks an exact match above a prefix one for "%s"',
    async (query, docId) => {
      expect((await docsFor(query))[0]).toBe(docId);
    },
  );
});

describe('policyCatalog', () => {
  it('lists every manifest doc by id and title, never from doc bodies', () => {
    const catalog = policyCatalog(loadManifest(POLICIES_DIR));
    expect(catalog).toHaveLength(10);
    expect(catalog[0]).toEqual({ doc_id: 'pol-01', title: 'Tiempos SPEI' });
    expect(catalog.at(-1)).toEqual({
      doc_id: 'pol-09b',
      title: 'Rechazos (anexo)',
    });
  });
});
