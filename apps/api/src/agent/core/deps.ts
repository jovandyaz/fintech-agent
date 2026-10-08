import { createAnthropic } from '@ai-sdk/anthropic';

import { canaryModelsOf } from '../../canaries/script.js';
import { canaryTemplateOf } from '../../canaries/templates.js';
import type { ApiConfig } from '../../config.js';
import type { Database } from '../../database/index.js';
import { injectionSignal } from '../../guard/prompt-guard.js';
import {
  ingestPolicies,
  loadManifest,
  readPolicyFiles,
} from '../../retrieval/ingest.js';
import { createRetrieval, policyCatalog } from '../../retrieval/search.js';
import type { RunCaseConfig, RunCaseDeps } from './run-case.js';
import { connectCaseTools, type PolicyCatalogEntry } from './tools.js';

// Listed, not filtered: a variable added to ApiConfig later stays out of the
// agent until someone names it here (02 G4 keeps the core read key out).
const AGENT_CONFIG_KEYS = [
  'ANTHROPIC_API_KEY',
  'AGENT_MODE',
  'AGENT_POLL_MS',
  'AGENT_VARIANT',
  'AGENT_MODEL_A',
  'AGENT_MODEL_B',
  'REDACTOR_MODEL',
  'RUN_TIMEOUT_MS',
  'RUN_COST_CEILING_USD',
  'RUN_INPUT_TOKEN_CEILING',
  'MCP_URL',
  'MCP_AUDIENCE',
  'CASE_TOKEN_KEY',
] as const satisfies readonly (keyof ApiConfig)[];

/** The part of the `api` config the agent may hold. */
export type AgentConfig = Pick<ApiConfig, (typeof AGENT_CONFIG_KEYS)[number]>;

/** Copies only the agent's variables out of the full config. */
export function agentConfigOf(config: ApiConfig): AgentConfig {
  return Object.fromEntries(
    AGENT_CONFIG_KEYS.map((key) => [key, config[key]]),
  ) as AgentConfig;
}

/** The settings one attempt runs under, from the validated env (01 §Stack). */
export function runCaseConfigOf(config: AgentConfig): RunCaseConfig {
  return {
    mode: config.AGENT_MODE,
    variant: config.AGENT_VARIANT,
    modelId:
      config.AGENT_VARIANT === 'A'
        ? config.AGENT_MODEL_A
        : config.AGENT_MODEL_B,
    redactorModelId: config.REDACTOR_MODEL,
    runTimeoutMs: config.RUN_TIMEOUT_MS,
    budget: {
      costUsd: config.RUN_COST_CEILING_USD,
      inputTokens: config.RUN_INPUT_TOKEN_CEILING,
    },
    mcpUrl: config.MCP_URL,
    mcpAudience: config.MCP_AUDIENCE,
    caseTokenKey: config.CASE_TOKEN_KEY,
  };
}

/** The provider's models, or none for a blank key: runs then end `no_api_key`. */
export function modelsOf(apiKey: string): RunCaseDeps['models'] {
  if (apiKey === '') return null;
  const anthropic = createAnthropic({ apiKey });
  return (modelId) => anthropic(modelId);
}

/**
 * The `search_policies` catalog from a corpus that passes the same checks
 * `seed` applies; a refused corpus or a title the guard flags throws, so
 * `api` never boots with a description every run would read (02 G8).
 */
export function loadCatalog(dir: string): PolicyCatalogEntry[] {
  // One read: the titles served are the ones the checks passed.
  const manifest = loadManifest(dir);
  ingestPolicies(manifest, readPolicyFiles(dir));
  return policyCatalog(manifest);
}

/** Everything `runCase` needs in `api`; tests and evals build their own. */
export function runCaseDepsOf(input: {
  config: AgentConfig;
  db: Database;
  catalog: readonly PolicyCatalogEntry[];
  log: RunCaseDeps['log'];
}): RunCaseDeps {
  const config = runCaseConfigOf(input.config);
  return {
    db: input.db,
    config,
    models: modelsOf(input.config.ANTHROPIC_API_KEY),
    canaryModels: (defect) =>
      canaryModelsOf(canaryTemplateOf(defect), {
        redactorModelId: config.redactorModelId,
        agentModelId: config.modelId,
      }),
    retrieval: createRetrieval(input.db, input.catalog),
    scanInjection: injectionSignal,
    connectTools: connectCaseTools,
    clock: () => Date.now(),
    random: () => Math.random(),
    log: input.log,
  };
}
