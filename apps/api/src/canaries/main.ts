import { Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';

import { reasonOf } from '../common/errors/reason-of.js';
import { JsonConsoleLogger } from '../common/logging/json-console-logger.js';
import * as schema from '../database/schema.js';
import { injectCanaries } from './inject.js';

const InjectConfigSchema = z.object({ API_DATABASE_URL: z.url() });

Logger.overrideLogger(new JsonConsoleLogger());
const logger = new Logger('Canaries');
let sql: postgres.Sql | undefined;
try {
  const config = InjectConfigSchema.parse(process.env);
  sql = postgres(config.API_DATABASE_URL, {
    max: 1,
    onnotice: () => undefined,
  });
  const actionIds = await injectCanaries(drizzle({ client: sql, schema }), {
    now: () => new Date(),
  });
  logger.log({ event: 'canaries_injected', count: actionIds.length });
} catch (error) {
  logger.fatal({ event: 'canary_inject_failed', reason: reasonOf(error) });
  process.exitCode = 1;
} finally {
  await sql?.end();
}
