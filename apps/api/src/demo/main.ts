import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';

import { reasonOf } from '../common/errors/reason-of.js';
import { JsonConsoleLogger } from '../common/logging/json-console-logger.js';
import { demoConfigOf, postFixtures } from './post-fixtures.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');

Logger.overrideLogger(new JsonConsoleLogger());
const logger = new Logger('Demo');
try {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    throw new Error('usage: pnpm demo:post <id…> from data/webhook-fixtures');
  }
  const config = demoConfigOf(
    process.env,
    readFileSync(resolve(REPO_ROOT, '.env.example'), 'utf8'),
  );
  const posted = await postFixtures({
    ids,
    ...config,
    fixturesDir: resolve(REPO_ROOT, 'data/webhook-fixtures'),
    now: () => new Date(),
  });
  for (const answer of posted)
    logger.log({ event: 'fixture_posted', ...answer });
  if (posted.some(({ ok }) => !ok)) process.exitCode = 1;
} catch (error) {
  logger.fatal({ event: 'demo_post_failed', reason: reasonOf(error) });
  process.exitCode = 1;
}
