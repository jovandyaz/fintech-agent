import { parseEnv } from 'node:util';

import type { LanguageModel } from 'ai';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  agentConfigOf,
  loadCatalog,
  runCaseDepsOf,
} from '../agent/core/deps.js';
import { usageCostUsd } from '../agent/core/cost.js';
import { pricingOf } from '../agent/core/prices.js';
import { failLeftoverEvalCases } from '../agent/core/queue.js';
import { redactCase } from '../agent/core/redact.js';
import {
  REDACTOR_TIMEOUT_MS,
  type RunCaseDeps,
} from '../agent/core/run-case.js';
import { assertApiEnv } from '../boot.js';
import { loadApiConfig, type AGENT_VARIANTS } from '../config.js';
import * as schema from '../database/schema.js';
import { POLICIES_DIR } from '../retrieval/ingest.js';

const AGENT_ON = 'on';
// Both variants share the redactor model, so either one's deps serve it.
const REDACTOR_VARIANT = 'A';
const DEGRADED = 'degraded';
// 02 G1: the dev default in .env.example names the executor key too; the
// eval process never keeps it.
const EXECUTOR_KEY = 'CORE_EXECUTOR_KEY';

/** The harness of one eval run: per-variant dependencies over one database pool. */
export interface EvalHarness {
  depsFor: (variant: (typeof AGENT_VARIANTS)[number]) => RunCaseDeps;
  /** Runs the intake redactor on masked text, at its 20 s ceiling; degraded and free without a key (03 Redactor recall). */
  redact: (textMasked: string) => Promise<{
    spans: readonly string[];
    degraded: boolean;
    costUsd: number;
  }>;
  /** Fails the eval cases an earlier run left behind; call it before opening any. */
  failLeftovers: (now: Date) => Promise<string[]>;
  close: () => Promise<void>;
}

/**
 * One intake redactor call for the recall eval (03): the spans it applied,
 * whether it degraded, and its cost at the redactor model's price; with no
 * model (no key) it is degraded and free, so a case reads as missed.
 */
export async function pricedRedaction(
  textMasked: string,
  redactor: { model: LanguageModel; modelId: string } | null,
): Promise<{ spans: readonly string[]; degraded: boolean; costUsd: number }> {
  if (redactor === null) return { spans: [], degraded: true, costUsd: 0 };
  const redaction = await redactCase(textMasked, {
    model: redactor.model,
    timeoutMs: REDACTOR_TIMEOUT_MS,
  });
  const usage = redaction.step?.usage;
  return {
    spans: redaction.applied,
    degraded: redaction.step?.outcome === DEGRADED,
    costUsd: usage ? usageCostUsd(usage, pricingOf(redactor.modelId)) : 0,
  };
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
  const depsFor: EvalHarness['depsFor'] = (variant) =>
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
    });
  return {
    depsFor,
    redact: (textMasked) => {
      const deps = depsFor(REDACTOR_VARIANT);
      const modelId = deps.config.redactorModelId;
      const model = deps.models?.(modelId);
      return pricedRedaction(textMasked, model ? { model, modelId } : null);
    },
    failLeftovers: (now) => failLeftoverEvalCases(db, now),
    close: () => sql.end(),
  };
}
