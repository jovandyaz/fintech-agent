import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { reasonOf } from '../common/errors/reason-of.js';
import { JsonConsoleLogger } from '../common/logging/json-console-logger.js';
import { migrateDatabase } from '../database/migrate.js';
import { setRolePasswords } from '../database/roles.js';
import { POLICIES_DIR, seedPolicies } from '../retrieval/corpus-write.js';

const SeedConfigSchema = z.object({
  DATABASE_URL: z.url(),
  API_DB_PASSWORD: z.string().min(1),
  EXECUTOR_DB_PASSWORD: z.string().min(1),
  MCP_DB_PASSWORD: z.string().min(1),
});

Logger.overrideLogger(new JsonConsoleLogger());
const logger = new Logger('Seed');
try {
  const config = SeedConfigSchema.parse(process.env);
  await migrateDatabase(config.DATABASE_URL);
  await setRolePasswords(config.DATABASE_URL, {
    copilot_api: config.API_DB_PASSWORD,
    copilot_executor: config.EXECUTOR_DB_PASSWORD,
    copilot_mcp: config.MCP_DB_PASSWORD,
  });
  const corpus = await seedPolicies(config.DATABASE_URL, POLICIES_DIR);
  logger.log({ event: 'policies_ingested', ...corpus });
  logger.log({ event: 'seed_done' });
} catch (error) {
  logger.fatal({ event: 'boot_failed', reason: reasonOf(error) });
  process.exitCode = 1;
}
