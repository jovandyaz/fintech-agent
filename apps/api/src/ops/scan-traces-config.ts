import { parseArgs, parseEnv } from 'node:util';

import { z } from 'zod';

const SCAN_WINDOW_MS = 24 * 60 * 60 * 1_000;

const DatabaseUrlSchema = z.url();
const SinceSchema = z.iso.datetime({ offset: true });
const REFUSAL = {
  usage: 'ops:scan-traces takes only --since <ISO instant>',
  since: '--since takes an ISO instant with Z or an offset',
  databaseUrl: 'API_DATABASE_URL must be a URL',
} as const;

/** Where `pnpm ops:scan-traces` reads and from when. */
export interface ScanTracesConfig {
  databaseUrl: string;
  since: Date;
}

function sinceOf(argv: readonly string[], now: Date): Date {
  let flag: string | undefined;
  try {
    flag = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: { since: { type: 'string' } },
    }).values.since;
  } catch {
    throw new Error(REFUSAL.usage);
  }
  if (flag === undefined) return new Date(now.getTime() - SCAN_WINDOW_MS);
  const parsed = SinceSchema.safeParse(flag);
  if (!parsed.success) throw new Error(REFUSAL.since);
  return new Date(parsed.data);
}

/**
 * The trace scan's settings: `API_DATABASE_URL` from the environment over the
 * dev default in `.env.example` (null where there is none, as in the api
 * image), as `pnpm canary:inject` reads it, and the last 24 hours unless
 * `--since <ISO instant>` says otherwise. Throws a one-line message on any
 * other argument, a time without a date, a clock and a zone, or a malformed url.
 */
export function scanTracesConfigOf(
  env: NodeJS.ProcessEnv,
  envExample: string | null,
  argv: readonly string[],
  now: Date,
): ScanTracesConfig {
  const since = sinceOf(argv, now);
  const databaseUrl = DatabaseUrlSchema.safeParse(
    { ...(envExample === null ? {} : parseEnv(envExample)), ...env }
      .API_DATABASE_URL,
  );
  if (!databaseUrl.success) throw new Error(REFUSAL.databaseUrl);
  return { databaseUrl: databaseUrl.data, since };
}
