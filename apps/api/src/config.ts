import {
  CASE_TOKEN_MAX_TTL_S,
  CASE_TOKEN_MIN_KEY_BYTES,
  parseWebhookSecrets,
} from '@fintech-agent/contracts';
import { z } from 'zod';

import {
  HAIKU_MODEL,
  PRICED_MODELS,
  PRICED_PROMPT_TOKENS_MAX,
  SONNET_MODEL,
} from './agent/core/prices.js';

const DEFAULT_API_PORT = 3000;
const DEFAULT_RUN_TIMEOUT_MS = 180_000;
const DEFAULT_AGENT_POLL_MS = 1_000;
// Node clamps a timer past 2^31-1 ms to 1 ms; a minute is already idle enough.
const MAX_AGENT_POLL_MS = 60_000;
const DEFAULT_RUN_COST_CEILING_USD = 0.5;
const DEFAULT_RUN_INPUT_TOKEN_CEILING = 60_000;
const MS_PER_SECOND = 1000;
/** The case token outlives the attempt by this much (01 §The agentic node). */
export const CASE_TOKEN_MARGIN_MS = 60_000;

/** Whether the worker calls the model (01 §Webhook and queue, kill switch). */
export const AGENT_MODES = ['on', 'off'] as const;
/** Whether `api` runs the queue worker; `off` leaves it HTTP-only. */
export const AGENT_WORKER_STATES = ['on', 'off'] as const;
/** The two agent variants the evals compare (01 §Stack, Models). */
export const AGENT_VARIANTS = ['A', 'B'] as const;

const pricedModel = (fallback: (typeof PRICED_MODELS)[number]) =>
  z.enum(PRICED_MODELS).default(fallback);

const ApiConfigSchema = z.object({
  API_DATABASE_URL: z.url(),
  API_PORT: z.coerce.number().int().positive().default(DEFAULT_API_PORT),
  OPERATOR_TOKENS: z.string().min(1),
  CORE_MOCK_URL: z.url(),
  CORE_READ_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().trim().default(''),
  AGENT_MODE: z.enum(AGENT_MODES).default('on'),
  AGENT_WORKER: z.enum(AGENT_WORKER_STATES).default('on'),
  AGENT_POLL_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_AGENT_POLL_MS)
    .default(DEFAULT_AGENT_POLL_MS),
  AGENT_VARIANT: z.enum(AGENT_VARIANTS).default('A'),
  AGENT_MODEL_A: pricedModel(SONNET_MODEL),
  AGENT_MODEL_B: pricedModel(HAIKU_MODEL),
  REDACTOR_MODEL: pricedModel(HAIKU_MODEL),
  RUN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(CASE_TOKEN_MAX_TTL_S * MS_PER_SECOND - CASE_TOKEN_MARGIN_MS)
    .default(DEFAULT_RUN_TIMEOUT_MS),
  RUN_COST_CEILING_USD: z.coerce
    .number()
    .positive()
    .default(DEFAULT_RUN_COST_CEILING_USD),
  RUN_INPUT_TOKEN_CEILING: z.coerce
    .number()
    .int()
    .positive()
    .max(PRICED_PROMPT_TOKENS_MAX)
    .default(DEFAULT_RUN_INPUT_TOKEN_CEILING),
  MCP_URL: z.url(),
  MCP_AUDIENCE: z.url(),
  CASE_TOKEN_KEY: z
    .string()
    .refine(
      (key) =>
        new TextEncoder().encode(key).byteLength >= CASE_TOKEN_MIN_KEY_BYTES,
      { message: `must be at least ${CASE_TOKEN_MIN_KEY_BYTES} bytes` },
    ),
  WEBHOOK_SECRET: z.string().refine(
    (raw) => {
      try {
        parseWebhookSecrets(raw);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'must be whsec_<base64>, several separated by spaces' },
  ),
});

export type ApiConfig = z.infer<typeof ApiConfigSchema>;

/** Read once at boot; a missing or malformed variable stops the process. */
export const loadApiConfig = (env: NodeJS.ProcessEnv): ApiConfig =>
  ApiConfigSchema.parse(env);
