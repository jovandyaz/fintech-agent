import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { reasonOf } from '../common/errors/reason-of.js';
import { JsonConsoleLogger } from '../common/logging/json-console-logger.js';
import * as schema from '../database/schema.js';
import { injectCanaries } from './inject.js';
import { injectConfigOf } from './inject-config.js';

const ENV_EXAMPLE = resolve(import.meta.dirname, '../../../../.env.example');

Logger.overrideLogger(new JsonConsoleLogger());
const logger = new Logger('Canaries');
let sql: postgres.Sql | undefined;
try {
  const config = injectConfigOf(
    process.env,
    existsSync(ENV_EXAMPLE) ? readFileSync(ENV_EXAMPLE, 'utf8') : null,
  );
  sql = postgres(config.databaseUrl, {
    max: 1,
    onnotice: () => undefined,
  });
  const caseIds = await injectCanaries(drizzle({ client: sql, schema }), {
    now: () => new Date(),
    random: () => Math.random(),
    sleep: (ms) => sleep(ms),
    spreadMs: config.spreadMs,
  });
  logger.log({ event: 'canaries_injected', count: caseIds.length });
} catch (error) {
  logger.fatal({ event: 'canary_inject_failed', reason: reasonOf(error) });
  process.exitCode = 1;
} finally {
  await sql?.end();
}
