import { parseEnv } from 'node:util';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  agentConfigOf,
  loadCatalog,
  runCaseDepsOf,
} from '../agent/core/deps.js';
import type { RunCaseDeps } from '../agent/core/run-case.js';
import { loadApiConfig, type AGENT_VARIANTS } from '../config.js';
import * as schema from '../database/schema.js';
import { POLICIES_DIR } from '../retrieval/ingest.js';

const AGENT_ON = 'on';
// 02 G1: only the executor holds its key; the eval process never keeps it.
const EXECUTOR_KEY = 'CORE_EXECUTOR_KEY';

/** The harness of one eval run: per-variant dependencies over one database pool. */
export interface EvalHarness {
  depsFor: (variant: (typeof AGENT_VARIANTS)[number]) => RunCaseDeps;
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
    close: () => sql.end(),
  };
}
