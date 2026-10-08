import { isIP } from 'node:net';

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

const PREFIX = /^\d+$/;
// The widest subnet a proxy list may name: a whole private range, or /0, would
// trust as good as everyone, which `true` already stands for.
const PREFIX_BITS = {
  4: { min: 16, max: 32 },
  6: { min: 48, max: 128 },
} as const;

const IPV6_GROUPS = 8;
const BITS_PER_BYTE = 8;
// ::ffff:0:0/96, the IPv4-mapped range: its first six groups.
const MAPPED_HEAD = [0, 0, 0, 0, 0, 0xffff];
const MAPPED_PREFIX_BITS = 96;
const ZONE_MARK = '%';

const groupsOf = (text: string): number[] =>
  text === ''
    ? []
    : text.split(':').flatMap((group) => {
        if (!group.includes('.')) return [Number.parseInt(group, 16)];
        const [a = 0, b = 0, c = 0, d = 0] = group.split('.').map(Number);
        return [(a << BITS_PER_BYTE) | b, (c << BITS_PER_BYTE) | d];
      });

// proxy-addr matches an IPv4 client against an IPv4-mapped subnet, so
// ::ffff:0.0.0.0/96 trusts every IPv4 address as much as 0.0.0.0/0 does.
const isIpv4Mapped = (address: string): boolean => {
  const [head = '', tail] = address.toLowerCase().split('::');
  const left = groupsOf(head);
  const right = tail === undefined ? [] : groupsOf(tail);
  const groups = [
    ...left,
    ...Array<number>(IPV6_GROUPS - left.length - right.length).fill(0),
    ...right,
  ];
  return MAPPED_HEAD.every((group, index) => groups[index] === group);
};

// Express also takes `true`, hop counts and named subnets; each would trust
// addresses nobody listed, so only explicit addresses and narrow subnets pass.
const isTrustedEntry = (entry: string): boolean => {
  const [address = '', prefix, extra] = entry.trim().split('/');
  const family = isIP(address);
  // A proxy is never named by a link-local zone, and isIP accepts any text
  // after %, which no group count can read.
  if (address.includes(ZONE_MARK)) return false;
  if ((family !== 4 && family !== 6) || extra !== undefined) return false;
  if (prefix === undefined) return true;
  if (!PREFIX.test(prefix)) return false;
  const mapped = family === 6 && isIpv4Mapped(address);
  const bits = PREFIX_BITS[mapped ? 4 : family];
  const prefixBits = Number(prefix) - (mapped ? MAPPED_PREFIX_BITS : 0);
  return prefixBits >= bits.min && prefixBits <= bits.max;
};

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
  TRUST_PROXY: z
    .string()
    .trim()
    .default('')
    .refine((value) => value === '' || value.split(',').every(isTrustedEntry), {
      message: 'must list IP addresses or subnets, comma-separated',
    }),
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
