import {
  composeVersionCheck,
  fail,
  heldPorts,
  nodeVersionCheck,
  note,
  pass,
  portCheck,
  publishedPorts,
  runningServices,
  stackSubnet,
  subnetCheck,
  type Check,
  type ComposeConfig,
  type PortState,
  type PublishedPort,
} from './checks.ts';
import {
  captureDocker,
  composeConfig,
  composePs,
  dockerNetworks,
} from './docker.ts';
import type { Env } from './config.ts';
import {
  dependenciesInstalled,
  enginesNode,
  firstLine,
  portIsBusy,
  reasonOf,
} from './system.ts';

/**
 * Docker, its daemon and the Compose plugin, in that order; it stops at the
 * first failure, since each later check needs the earlier one.
 */
export function dockerChecks(): Check[] {
  const cli = captureDocker(['--version']);
  if (cli.missing || cli.status !== 0) {
    return [
      fail(
        'Docker is not installed',
        'Install Docker Desktop (macOS, Windows) or Docker Engine (Linux): https://docs.docker.com/get-started/get-docker/',
      ),
    ];
  }
  const daemon = captureDocker(['info', '--format', '{{.ServerVersion}}']);
  if (daemon.status !== 0) {
    return [
      fail(
        `Docker is installed but its daemon does not answer (${firstLine(daemon.stderr)})`,
        'Start Docker Desktop and wait until it reports it is running. On Linux: sudo systemctl start docker, ' +
          'and add yourself to the docker group (https://docs.docker.com/engine/install/linux-postinstall/).',
      ),
    ];
  }
  const composeVersion = captureDocker(['compose', 'version', '--short']);
  return [
    pass(`Docker Engine ${daemon.stdout.trim()}`),
    composeVersionCheck(
      composeVersion.status === 0 ? composeVersion.stdout : '',
    ),
  ];
}

/** Node against package.json engines, installed dependencies, then Docker. */
export function toolChecks(): Check[] {
  return [
    nodeVersionCheck(process.version, enginesNode()),
    dependenciesInstalled()
      ? pass('Dependencies installed')
      : fail('Dependencies are not installed', 'Run: pnpm install'),
    ...dockerChecks(),
  ];
}

export interface Stack {
  project: string;
  ports: PublishedPort[];
  running: string[];
}

async function portState(
  port: PublishedPort,
  held: ReadonlySet<number>,
): Promise<PortState> {
  if (held.has(port.port)) return 'own';
  return (await portIsBusy(port.port)) ? 'busy' : 'free';
}

/**
 * The compose project as `env` resolves it: every host port it publishes is
 * free or already its own, and no other Docker network overlaps its subnet.
 */
export async function stackChecks(
  env: Env,
): Promise<{ checks: Check[]; stack: Stack | undefined }> {
  let resolved: ComposeConfig;
  let raw: ComposeConfig;
  try {
    resolved = composeConfig(env, true);
    raw = composeConfig(env, false);
  } catch (error) {
    return {
      checks: [
        fail(
          `docker compose config failed: ${reasonOf(error)}`,
          'Fix the value it names in .env or your shell, then try again.',
        ),
      ],
      stack: undefined,
    };
  }
  const project = resolved.name;
  const rows = composePs(env);
  const held = heldPorts(rows);
  const ports = publishedPorts(resolved, raw);
  const checks = await Promise.all(
    ports.map(async (port) =>
      portCheck(port, await portState(port, held), project),
    ),
  );
  const subnet = stackSubnet(resolved);
  if (subnet !== undefined) {
    try {
      checks.push(subnetCheck(dockerNetworks(), subnet, project));
    } catch (error) {
      checks.push(note(`Could not list Docker networks: ${reasonOf(error)}`));
    }
  }
  return {
    checks,
    stack: { project, ports, running: runningServices(rows) },
  };
}
