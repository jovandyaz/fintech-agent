import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../database/schema.js';
import { runScan } from './run-scan.js';
import { scanTracesConfigOf } from './scan-traces-config.js';
import { scanStoredText } from './scan-traces.js';

const ENV_EXAMPLE = resolve(import.meta.dirname, '../../../../.env.example');

await runScan('ScanTraces', async () => {
  const config = scanTracesConfigOf(
    process.env,
    existsSync(ENV_EXAMPLE) ? readFileSync(ENV_EXAMPLE, 'utf8') : null,
    process.argv.slice(2),
    new Date(),
  );
  const sql = postgres(config.databaseUrl, {
    max: 1,
    onnotice: () => undefined,
  });
  try {
    return await scanStoredText(drizzle({ client: sql, schema }), config.since);
  } finally {
    await sql.end();
  }
});
