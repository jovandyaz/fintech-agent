/** How a preflight check came out: a note is worth reading but stops nothing. */
export type CheckLevel = 'pass' | 'note' | 'fail';

/** One preflight result; a failure carries the fix to print under it. */
export interface Check {
  level: CheckLevel;
  text: string;
  fix?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const pass = (text: string): Check => ({ level: 'pass', text });
export const note = (text: string): Check => ({ level: 'note', text });
export const fail = (text: string, fix: string): Check => ({
  level: 'fail',
  text,
  fix,
});

type Version = readonly [number, number, number];

const ENGINES_MINIMUM = /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)/;

const parseVersion = (text: string): Version | undefined => {
  const found = VERSION.exec(text.trim());
  return found
    ? [Number(found[1]), Number(found[2]), Number(found[3])]
    : undefined;
};

const olderThan = (a: Version, b: Version): boolean => {
  const index = a.findIndex((part, i) => part !== b[i]);
  return index !== -1 && a[index]! < b[index]!;
};

/**
 * Checks a Node version (`process.version`) against package.json `engines.node`.
 * Only a `>=` range is read; any other throws, so a changed range is never
 * silently misread.
 */
export function nodeVersionCheck(version: string, engines: string): Check {
  const minimum = ENGINES_MINIMUM.exec(engines.trim());
  if (!minimum) {
    throw new Error(`cannot read engines.node "${engines}"; use >=<version>`);
  }
  const [, major = '0', minor = '0', patch = '0'] = minimum;
  const required: Version = [Number(major), Number(minor), Number(patch)];
  const current = parseVersion(version);
  if (current && !olderThan(current, required)) return pass(`Node ${version}`);
  return fail(
    `Node ${version} is older than this repo needs (${engines}, package.json engines)`,
    `Install Node ${major}, which .node-version pins: \`fnm install ${major}\` with fnm, ` +
      `\`nvm install ${major}\` with nvm, or the installer at https://nodejs.org. ` +
      'Then open a new terminal and run pnpm start again.',
  );
}

// The first release that honors COMPOSE_DISABLE_ENV_FILE, which keeps the
// user's .env (and its key) out of the throwaway e2e stack.
const MIN_COMPOSE: Version = [2, 24, 0];

/** Checks `docker compose version --short` against the minimum, 2.24.0. */
export function composeVersionCheck(short: string): Check {
  const version = short.trim();
  const current = parseVersion(version);
  if (current && !olderThan(current, MIN_COMPOSE)) {
    return pass(`Docker Compose ${version}`);
  }
  return fail(
    `Docker Compose ${MIN_COMPOSE.join('.')} or later is needed (found "${version}")`,
    'Update Docker Desktop; on Linux install or update the docker-compose-plugin package ' +
      '(https://docs.docker.com/compose/install/). The old docker-compose v1 is not supported.',
  );
}

/** An IPv4 block as the first and last address it covers. */
export interface Cidr {
  text: string;
  first: number;
  last: number;
}

const IPV4_CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;
const MAX_OCTET = 255;
const IPV4_BITS = 32;
const BITS_PER_OCTET = 8;

/** Parses an IPv4 CIDR block; undefined for IPv6 or anything malformed. */
export function parseCidr(text: string): Cidr | undefined {
  const match = IPV4_CIDR.exec(text.trim());
  if (!match) return undefined;
  const octets = match.slice(1, 5).map(Number);
  const prefix = Number(match[5]);
  if (octets.some((octet) => octet > MAX_OCTET) || prefix > IPV4_BITS) {
    return undefined;
  }
  const address = octets.reduce(
    (value, octet) => value * 2 ** BITS_PER_OCTET + octet,
    0,
  );
  const size = 2 ** (IPV4_BITS - prefix);
  const first = address - (address % size);
  return { text, first, last: first + size - 1 };
}

export function overlaps(a: Cidr, b: Cidr): boolean {
  return a.first <= b.last && b.first <= a.last;
}

export interface DockerNetwork {
  name: string;
  project: string | undefined;
  subnets: readonly string[];
}

const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';

export function parseNetworks(json: string): DockerNetwork[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error('docker network inspect did not print an array');
  }
  return parsed.filter(isRecord).map((network) => {
    const labels = isRecord(network.Labels) ? network.Labels : {};
    const project = labels[COMPOSE_PROJECT_LABEL];
    const ipam = isRecord(network.IPAM) ? network.IPAM : {};
    const configs = Array.isArray(ipam.Config) ? ipam.Config : [];
    return {
      name: typeof network.Name === 'string' ? network.Name : '',
      project: typeof project === 'string' ? project : undefined,
      subnets: configs.flatMap((config) =>
        isRecord(config) && typeof config.Subnet === 'string'
          ? [config.Subnet]
          : [],
      ),
    };
  });
}

function conflicts(
  networks: readonly DockerNetwork[],
  block: Cidr,
  project: string,
): DockerNetwork[] {
  return networks.filter(
    (network) =>
      network.project !== project &&
      network.subnets.some((subnet) => {
        const other = parseCidr(subnet);
        return other !== undefined && overlaps(other, block);
      }),
  );
}

/** A compose network layout like .env.example's: a /24, its upper half for Docker, the console at .10. */
export interface SubnetPlan {
  subnet: string;
  ipRange: string;
  consoleIp: string;
}

const LAST_SECOND_OCTET = 254;
/** Where suggested subnets start: the next block after .env.example's 10.231.0.0/24. */
export const FIRST_ALTERNATE_OCTET = 232;

/**
 * The first `10.N.0.0/24` layout, N from `fromOctet` up, that no other
 * project's network overlaps; undefined when every block is taken.
 */
export function freeSubnetPlan(
  networks: readonly DockerNetwork[],
  project: string,
  fromOctet: number,
): SubnetPlan | undefined {
  for (let octet = fromOctet; octet <= LAST_SECOND_OCTET; octet += 1) {
    const subnet = `10.${octet}.0.0/24`;
    const block = parseCidr(subnet);
    if (block && conflicts(networks, block, project).length === 0) {
      return {
        subnet,
        ipRange: `10.${octet}.0.128/25`,
        consoleIp: `10.${octet}.0.10`,
      };
    }
  }
  return undefined;
}

/**
 * Checks the stack's subnet against every Docker network but the project's
 * own; on an overlap the fix offers a free layout for the three variables.
 */
export function subnetCheck(
  networks: readonly DockerNetwork[],
  subnet: string,
  project: string,
): Check {
  const block = parseCidr(subnet);
  if (!block) {
    return fail(
      `COMPOSE_SUBNET "${subnet}" is not an IPv4 block`,
      'Set COMPOSE_SUBNET in .env to a block such as 10.231.0.0/24.',
    );
  }
  const clashing = conflicts(networks, block, project);
  if (clashing.length === 0) return pass(`Subnet ${subnet} is free`);
  const names = clashing
    .map((network) => `${network.name} (${network.subnets.join(', ')})`)
    .join(', ');
  const plan = freeSubnetPlan(networks, project, FIRST_ALTERNATE_OCTET);
  const move = plan
    ? 'Or move the stack: add to .env\n' +
      `  COMPOSE_SUBNET=${plan.subnet}\n` +
      `  COMPOSE_IP_RANGE=${plan.ipRange}\n` +
      `  CONSOLE_IP=${plan.consoleIp}`
    : 'Or move the stack: set COMPOSE_SUBNET, COMPOSE_IP_RANGE and CONSOLE_IP in .env ' +
      'to a free /24, its upper half and an address in the lower half.';
  return fail(
    `Subnet ${subnet} (COMPOSE_SUBNET) overlaps Docker network ${names}`,
    `Remove that network if nothing uses it (docker network rm <name>).\n${move}`,
  );
}

export interface PublishedPort {
  service: string;
  port: number;
  variable: string | undefined;
}

interface ComposePort {
  target?: number;
  published?: string | number;
}

/** The part of `docker compose config --format json` the port check reads. */
export interface ComposeServices {
  services: Record<string, { ports?: readonly (string | ComposePort)[] }>;
}

/** What `pnpm start` reads of `docker compose config --format json`. */
export interface ComposeConfig extends ComposeServices {
  name: string;
  networks?: Record<
    string,
    { ipam?: { config?: readonly { subnet?: string }[] } } | null
  >;
}

/**
 * Parses `docker compose config --format json`, resolved or not; throws when
 * the project name or the services are missing.
 */
export function parseComposeConfig(json: string): ComposeConfig {
  const parsed: unknown = JSON.parse(json);
  if (
    !isRecord(parsed) ||
    typeof parsed.name !== 'string' ||
    !isRecord(parsed.services)
  ) {
    throw new Error('docker compose config printed no project or services');
  }
  return parsed as unknown as ComposeConfig;
}

const DEFAULT_NETWORK = 'default';

/** The subnet the stack's default network pins, if it pins one. */
export function stackSubnet(config: ComposeConfig): string | undefined {
  return config.networks?.[DEFAULT_NETWORK]?.ipam?.config?.[0]?.subnet;
}

const LEADING_VARIABLE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)/;

/**
 * Each published host port, from the resolved config, with the variable
 * named at the same place in the uninterpolated one.
 */
export function publishedPorts(
  resolved: ComposeServices,
  raw: ComposeServices,
): PublishedPort[] {
  return Object.entries(resolved.services).flatMap(([service, { ports }]) =>
    (ports ?? []).flatMap((entry, index) => {
      const port = typeof entry === 'string' ? NaN : Number(entry.published);
      if (!Number.isInteger(port) || port <= 0) return [];
      const rawEntry = raw.services[service]?.ports?.[index];
      const rawPublished =
        typeof rawEntry === 'string' ? rawEntry : rawEntry?.published;
      const variable =
        typeof rawPublished === 'string'
          ? LEADING_VARIABLE.exec(rawPublished)?.[1]
          : undefined;
      return [{ service, port, variable }];
    }),
  );
}

/** Who holds a host port: nobody, this stack, or another program. */
export type PortState = 'free' | 'own' | 'busy';

/** Checks one host port; one this stack already holds is a note, not a failure. */
export function portCheck(
  port: PublishedPort,
  state: PortState,
  project: string,
): Check {
  const label = `Port ${port.port} (${port.service})`;
  if (state === 'free') return pass(`${label} is free`);
  if (state === 'own') {
    return note(`${label} is held by this stack (${project}), already running`);
  }
  return fail(
    `${label} is in use by another program`,
    port.variable
      ? `Stop that program, or move the stack: set ${port.variable}=<a free port> in .env.`
      : 'Stop that program.',
  );
}

/** One container of `docker compose ps --format json`. */
export interface PsRow {
  Service: string;
  State: string;
  Health: string;
  ExitCode: number;
  Publishers: readonly { PublishedPort: number }[] | null;
}

function toPsRow(value: unknown): PsRow[] {
  if (!isRecord(value) || typeof value.Service !== 'string') return [];
  return [
    {
      Service: value.Service,
      State: typeof value.State === 'string' ? value.State : '',
      Health: typeof value.Health === 'string' ? value.Health : '',
      ExitCode: typeof value.ExitCode === 'number' ? value.ExitCode : 0,
      Publishers: Array.isArray(value.Publishers)
        ? (value.Publishers as PsRow['Publishers'])
        : null,
    },
  ];
}

/**
 * Parses `docker compose ps --format json`: JSON Lines in current Compose, a
 * single array in releases before 2.21.
 */
export function parsePs(stdout: string): PsRow[] {
  const text = stdout.trim();
  if (text === '') return [];
  const values: unknown[] = text.startsWith('[')
    ? (JSON.parse(text) as unknown[])
    : text
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as unknown);
  return values.flatMap(toPsRow);
}

const RUNNING = 'running';

/** Each service with a running container, once however many replicas run. */
export function runningServices(rows: readonly PsRow[]): string[] {
  return [
    ...new Set(
      rows.filter((row) => row.State === RUNNING).map((row) => row.Service),
    ),
  ];
}

/** The host ports running containers publish; a stopped one holds none. */
export function heldPorts(rows: readonly PsRow[]): Set<number> {
  return new Set(
    rows
      .filter((row) => row.State === RUNNING)
      .flatMap((row) => row.Publishers ?? [])
      .map((publisher) => publisher.PublishedPort),
  );
}

const BROKEN_STATES = ['dead', 'restarting'] as const;

/**
 * The services worth reading the logs of after a failed start: crashed,
 * unhealthy or restarting. A one-shot that exited 0 (seed) is fine, and one
 * left `created` only waited on another.
 */
export function failingServices(rows: readonly PsRow[]): string[] {
  return rows
    .filter(
      (row) =>
        (row.State === 'exited' && row.ExitCode !== 0) ||
        (BROKEN_STATES as readonly string[]).includes(row.State) ||
        row.Health === 'unhealthy',
    )
    .map((row) => row.Service);
}

/** What each agent state of `/api/status` means at the console, keyed like contracts' AGENT_STATES. */
export const AGENT_STATUS: Readonly<Record<string, string>> = {
  on: 'on: each new case is investigated with the model, which costs money (RUN_COST_CEILING_USD caps one run).',
  off:
    'off, the kill switch (AGENT_MODE=off): cases reach review uninvestigated and nothing calls a model. ' +
    'The console banner reads «El agente está apagado».',
  no_api_key:
    'no_api_key: ANTHROPIC_API_KEY is empty, so each new case fails without a proposal. ' +
    'The console banner reads «El agente no tiene clave de API». ' +
    'Add the key to .env and run pnpm start again, or start with --agent-off.',
};

/** An unknown state comes back as it is. */
export function agentStatusText(state: string): string {
  return AGENT_STATUS[state] ?? state;
}
