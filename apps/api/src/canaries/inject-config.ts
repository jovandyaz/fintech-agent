import { parseEnv } from 'node:util';

import { z } from 'zod';

const InjectEnvSchema = z.object({
  API_DATABASE_URL: z.url(),
  CANARY_SPREAD_MS: z.coerce.number().int().nonnegative(),
});

/** Where `pnpm canary:inject` writes its cases and how far apart it spreads them. */
export interface InjectConfig {
  databaseUrl: string;
  spreadMs: number;
}

/**
 * The injector's settings: the environment over the dev defaults in
 * `.env.example` (null where there is none, as in the api image), so the host
 * command reaches the compose stack as `pnpm demo:post` does. Throws on a
 * malformed url or spread.
 */
export function injectConfigOf(
  env: NodeJS.ProcessEnv,
  envExample: string | null,
): InjectConfig {
  const parsed = InjectEnvSchema.parse({
    ...(envExample === null ? {} : parseEnv(envExample)),
    ...env,
  });
  return {
    databaseUrl: parsed.API_DATABASE_URL,
    spreadMs: parsed.CANARY_SPREAD_MS,
  };
}
