import { parseEnv } from 'node:util';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  agentConfigOf,
  loadCatalog,
  runCaseDepsOf,
} from '../agent/core/deps.js';
import { failLeftoverEvalCases } from '../agent/core/queue.js';
import type { RunCaseDeps } from '../agent/core/run-case.js';
import { assertApiEnv } from '../boot.js';
import { loadApiConfig, type AGENT_VARIANTS } from '../config.js';
import * as schema from '../database/schema.js';
import { POLICIES_DIR } from '../retrieval/ingest.js';

const AGENT_ON = 'on';
// 02 G1: the dev default in .env.example names the executor key too; the
// eval process never keeps it.
const EXECUTOR_KEY = 'CORE_EXECUTOR_KEY';

/** The harness of one eval run: per-variant dependencies over one database pool. */
export interface EvalHarness {
  depsFor: (variant: (typeof AGENT_VARIANTS)[number]) => RunCaseDeps;
  /** Fails the eval cases an earlier run left behind; call it before opening any. */
  failLeftovers: (now: Date) => Promise<string[]>;
  close: () => Promise<void>;
}

/**
 * The real harness for the eval runner, run from the host (03 §Runner):
 * the environment over the dev defaults in `.env.example`, so it reaches
 * the compose stack with only `ANTHROPIC_API_KEY` set; the agent always on,
 * whatever the kill switch says; the database as `copilot_api`.
 */
export function evalHarness(input: {
  env: NodeJS.ProcessEnv;
  envExample: string;
  log: RunCaseDeps['log'];
}): EvalHarness {
  assertApiEnv(input.env);
  const base = Object.fromEntries(
    Object.entries({ ...parseEnv(input.envExample), ...input.env }).filter(
      ([name]) => name !== EXECUTOR_KEY,
    ),
  );
  const shared = loadApiConfig({ ...base, AGENT_MODE: AGENT_ON });
  const sql = postgres(shared.API_DATABASE_URL, {
    onnotice: () => undefined,
  });
  const db = drizzle({ client: sql, schema });
  const catalog = loadCatalog(POLICIES_DIR);
  return {
    depsFor: (variant) =>
      runCaseDepsOf({
        config: agentConfigOf(
          loadApiConfig({
            ...base,
            AGENT_MODE: AGENT_ON,
            AGENT_VARIANT: variant,
          }),
        ),
        db,
        catalog,
        log: input.log,
      }),
    failLeftovers: (now) => failLeftoverEvalCases(db, now),
    close: () => sql.end(),
  };
}
