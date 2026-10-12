import {
  failingServices,
  parseComposeConfig,
  parseNetworks,
  parsePs,
  type ComposeConfig,
  type DockerNetwork,
  type PsRow,
} from './checks.ts';
import { capture, firstLine, run, type Captured } from './system.ts';
import type { Env } from './config.ts';
import { heading, warn } from './terminal.ts';

const DOCKER = 'docker';
const COMPOSE = 'compose';

export function captureDocker(
  args: readonly string[],
  env: Env = process.env,
): Captured {
  return capture(DOCKER, args, env);
}

/**
 * The project's compose config, interpolated as `up` would or raw. Throws
 * with compose's own message when the file or an env value is invalid.
 */
export function composeConfig(env: Env, interpolate: boolean): ComposeConfig {
  const result = captureDocker(
    [
      COMPOSE,
      'config',
      '--format',
      'json',
      ...(interpolate ? [] : ['--no-interpolate']),
    ],
    env,
  );
  if (result.status !== 0) {
    throw new Error(firstLine(result.stderr) || 'docker compose config failed');
  }
  return parseComposeConfig(result.stdout);
}

/** The project's containers, running ones only unless `all`; none if compose fails. */
export function composePs(env: Env, all = false): PsRow[] {
  const result = captureDocker(
    [COMPOSE, 'ps', ...(all ? ['--all'] : []), '--format', 'json'],
    env,
  );
  return result.status === 0 ? parsePs(result.stdout) : [];
}

/**
 * Every Docker network with its subnets. A network removed between the
 * listing and the inspection is left out rather than failing the lot.
 */
export function dockerNetworks(): DockerNetwork[] {
  const listed = captureDocker(['network', 'ls', '--quiet']);
  if (listed.status !== 0) {
    throw new Error(firstLine(listed.stderr) || 'docker network ls failed');
  }
  const ids = listed.stdout.split(/\s+/).filter((id) => id !== '');
  if (ids.length === 0) return [];
  const inspected = captureDocker(['network', 'inspect', ...ids]);
  if (inspected.stdout.trim() === '') {
    throw new Error(
      firstLine(inspected.stderr) || 'docker network inspect failed',
    );
  }
  return parseNetworks(inspected.stdout);
}

export function compose(args: readonly string[], env: Env): Promise<number> {
  return run(DOCKER, [COMPOSE, ...args], env);
}

const LOG_TAIL_LINES = 40;

/**
 * After a failed `up`: the containers, the log tail of each failing service,
 * and where to look next.
 */
export async function explainFailedStart(env: Env): Promise<void> {
  heading('The stack did not come up');
  await compose(['ps', '--all'], env);
  const failing = failingServices(composePs(env, true));
  for (const service of failing) {
    heading(`Last ${LOG_TAIL_LINES} log lines of ${service}`);
    await compose(
      ['logs', '--no-color', '--tail', String(LOG_TAIL_LINES), service],
      env,
    );
  }
  if (failing.length === 0) {
    warn(
      'No container failed: a build or an image pull did. Its error is in the output above.',
    );
  }
  console.log(
    '\nThe full log of a service: docker compose logs <service>.\n' +
      'Port in use, subnet overlap or a stale console: see Troubleshooting in README.md.\n' +
      'Re-run the checks with: pnpm start --check',
  );
}
