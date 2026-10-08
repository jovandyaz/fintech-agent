import { writeFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';

import { createCoreClient } from '@fintech-agent/contracts';
import { Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';

import { reasonOf } from '../common/errors/reason-of.js';
import { JsonConsoleLogger } from '../common/logging/json-console-logger.js';
import * as schema from '../database/schema.js';
import { createCoreWriteClient } from './core-write-client.js';
import {
  claimNext,
  executeClaimed,
  LOST_CLAIM,
  sweep,
  type ExecutorDeps,
} from './drain.js';
import { runLoop } from './loop.js';

const DEFAULT_POLL_MS = 1_000;
// Node clamps a timer past 2^31-1 ms to 1 ms; a minute is already idle enough.
const MAX_POLL_MS = 60_000;
// The compose healthcheck reads this file's age; a stuck loop stops touching it.
const HEARTBEAT_FILE = '/tmp/executor-alive';
const POOL_SIZE = 2;

const ExecutorConfigSchema = z.object({
  EXECUTOR_DATABASE_URL: z.url(),
  CORE_MOCK_URL: z.url(),
  CORE_EXECUTOR_KEY: z.string().min(1),
  EXECUTOR_POLL_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_POLL_MS)
    .default(DEFAULT_POLL_MS),
});

Logger.overrideLogger(new JsonConsoleLogger());
const logger = new Logger('Executor');
const stop = new AbortController();
process.once('SIGTERM', () => stop.abort());
process.once('SIGINT', () => stop.abort());

let sql: postgres.Sql | undefined;
try {
  const config = ExecutorConfigSchema.parse(process.env);
  sql = postgres(config.EXECUTOR_DATABASE_URL, {
    max: POOL_SIZE,
    onnotice: () => undefined,
  });
  const deps: ExecutorDeps = {
    db: drizzle({ client: sql, schema }),
    // core-mock accepts the executor key for reads, so it holds no second key.
    core: createCoreClient({
      baseUrl: config.CORE_MOCK_URL,
      readKey: config.CORE_EXECUTOR_KEY,
      fetch,
    }),
    writer: createCoreWriteClient({
      baseUrl: config.CORE_MOCK_URL,
      executorKey: config.CORE_EXECUTOR_KEY,
      fetch,
    }),
    now: () => new Date(),
    onDeferred: (actionId, reason) =>
      logger.warn({ event: 'execution_deferred', action_id: actionId, reason }),
    onFinished: ({ actionId, status, reason }) =>
      logger.log({
        event: 'execution_finished',
        action_id: actionId,
        status,
        reason,
      }),
  };
  const reportCycle = (error: unknown): void =>
    logger.error({ event: 'executor_cycle_failed', reason: reasonOf(error) });
  logger.log({ event: 'executor_started' });
  await runLoop({
    heartbeat: () => writeFileSync(HEARTBEAT_FILE, ''),
    drainOne: async () => {
      const claimed = await claimNext(deps);
      if (!claimed) return false;
      if (claimed !== LOST_CLAIM) await executeClaimed(deps, claimed);
      return true;
    },
    sweep: () => sweep(deps, { signal: stop.signal, onError: reportCycle }),
    sleep: () =>
      wait(config.EXECUTOR_POLL_MS, undefined, { signal: stop.signal }).catch(
        () => undefined,
      ),
    signal: stop.signal,
    onError: reportCycle,
  });
  logger.log({ event: 'executor_stopped' });
} catch (error) {
  logger.fatal({ event: 'boot_failed', reason: reasonOf(error) });
  process.exitCode = 1;
} finally {
  await sql?.end();
}
