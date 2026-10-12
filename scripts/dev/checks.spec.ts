import { describe, expect, it } from 'vitest';

import { AGENT_STATES } from '../../packages/contracts/src/console.ts';
import {
  AGENT_STATUS,
  agentStatusText,
  composeVersionCheck,
  failingServices,
  freeSubnetPlan,
  heldPorts,
  nodeVersionCheck,
  overlaps,
  parseCidr,
  parseComposeConfig,
  parseNetworks,
  parsePs,
  portCheck,
  publishedPorts,
  runningServices,
  stackSubnet,
  subnetCheck,
  type DockerNetwork,
} from './checks.ts';

const cidr = (text: string) => {
  const parsed = parseCidr(text);
  if (!parsed) throw new Error(`bad test cidr ${text}`);
  return parsed;
};

describe('nodeVersionCheck', () => {
  it('passes a Node that meets engines', () => {
    expect(nodeVersionCheck('v24.0.0', '>=24').level).toBe('pass');
    expect(nodeVersionCheck('v25.1.0', '>=24').level).toBe('pass');
  });

  it('fails an older Node and says how to get 24', () => {
    const check = nodeVersionCheck('v22.23.2', '>=24');
    expect(check.level).toBe('fail');
    expect(check.text).toContain('v22.23.2');
    expect(check.fix).toMatch(/fnm install 24/);
    expect(check.fix).toMatch(/nodejs\.org/);
  });

  it('compares minor and patch when engines names them', () => {
    expect(nodeVersionCheck('v24.2.9', '>=24.3').level).toBe('fail');
    expect(nodeVersionCheck('v24.3.0', '>= 24.3.0').level).toBe('pass');
  });

  it('refuses an engines range it cannot read rather than guess', () => {
    expect(() => nodeVersionCheck('v24.0.0', '^24')).toThrow(/engines/);
  });
});

describe('composeVersionCheck', () => {
  it('passes Compose 2.24 and later, with or without a v or a build suffix', () => {
    expect(composeVersionCheck('5.5.1').level).toBe('pass');
    expect(composeVersionCheck('v2.29.7').level).toBe('pass');
    expect(composeVersionCheck('2.24.0').level).toBe('pass');
    expect(composeVersionCheck('2.24.6-desktop.1').level).toBe('pass');
  });

  it('fails a Compose v2 that ignores COMPOSE_DISABLE_ENV_FILE', () => {
    const check = composeVersionCheck('2.23.3');
    expect(check.level).toBe('fail');
    expect(check.text).toContain('2.24');
  });

  it('fails Compose v1 and output it cannot read', () => {
    expect(composeVersionCheck('1.29.2').level).toBe('fail');
    expect(composeVersionCheck('').level).toBe('fail');
  });
});

describe('parseCidr and overlaps', () => {
  it('reads an IPv4 block and ignores IPv6 or garbage', () => {
    expect(parseCidr('10.231.0.0/24')).toBeDefined();
    expect(parseCidr('fd00:dead::/64')).toBeUndefined();
    expect(parseCidr('10.231.0.0')).toBeUndefined();
    expect(parseCidr('10.300.0.0/24')).toBeUndefined();
    expect(parseCidr('10.0.0.0/33')).toBeUndefined();
  });

  it.each([
    ['10.231.0.0/24', '10.231.0.128/25', true],
    ['10.231.0.0/24', '10.0.0.0/8', true],
    ['10.231.0.0/24', '172.17.0.0/16', false],
    ['10.231.0.0/24', '10.231.1.0/24', false],
    ['0.0.0.0/0', '192.168.1.0/24', true],
  ])('%s overlaps %s: %s', (a, b, expected) => {
    expect(overlaps(cidr(a), cidr(b))).toBe(expected);
    expect(overlaps(cidr(b), cidr(a))).toBe(expected);
  });
});

describe('subnetCheck', () => {
  const own: DockerNetwork = {
    name: 'fintech-agent_default',
    project: 'fintech-agent',
    subnets: ['10.231.0.0/24'],
  };
  const bridge: DockerNetwork = {
    name: 'bridge',
    project: undefined,
    subnets: ['172.17.0.0/16'],
  };

  it("passes when only the stack's own network holds the subnet", () => {
    expect(
      subnetCheck([own, bridge], '10.231.0.0/24', 'fintech-agent').level,
    ).toBe('pass');
  });

  it('fails on an overlapping network and offers a free block for the three variables', () => {
    const vpn: DockerNetwork = {
      name: 'vpn_default',
      project: 'vpn',
      subnets: ['fd00::/64', '10.231.0.0/16'],
    };
    const check = subnetCheck([own, bridge, vpn], '10.231.0.0/24', 'other');
    expect(check.level).toBe('fail');
    expect(check.text).toContain('vpn_default');
    expect(check.fix).toContain('COMPOSE_SUBNET=10.232.0.0/24');
    expect(check.fix).toContain('COMPOSE_IP_RANGE=10.232.0.128/25');
    expect(check.fix).toContain('CONSOLE_IP=10.232.0.10');
  });

  it('still names the three variables when no block is free', () => {
    const vpn: DockerNetwork = {
      name: 'vpn_default',
      project: 'vpn',
      subnets: ['10.0.0.0/8'],
    };
    const check = subnetCheck([vpn], '10.231.0.0/24', 'fintech-agent');
    expect(check.level).toBe('fail');
    expect(check.fix).toMatch(/COMPOSE_SUBNET.*COMPOSE_IP_RANGE.*CONSOLE_IP/s);
  });
});

describe('freeSubnetPlan', () => {
  it('starts from the given second octet and skips taken blocks', () => {
    const taken: DockerNetwork = {
      name: 'x',
      project: 'x',
      subnets: ['10.232.0.0/16'],
    };
    expect(freeSubnetPlan([taken], 'fintech-e2e', 232)).toEqual({
      subnet: '10.233.0.0/24',
      ipRange: '10.233.0.128/25',
      consoleIp: '10.233.0.10',
    });
  });

  it("ignores the project's own leftover network", () => {
    const leftover: DockerNetwork = {
      name: 'fintech-e2e_default',
      project: 'fintech-e2e',
      subnets: ['10.232.0.0/24'],
    };
    expect(freeSubnetPlan([leftover], 'fintech-e2e', 232)?.subnet).toBe(
      '10.232.0.0/24',
    );
  });

  it('gives up when no block is free', () => {
    const everything: DockerNetwork = {
      name: 'x',
      project: 'x',
      subnets: ['10.0.0.0/8'],
    };
    expect(freeSubnetPlan([everything], 'p', 232)).toBeUndefined();
  });
});

describe('publishedPorts', () => {
  const resolved = {
    services: {
      api: { ports: [{ target: 3000, published: '3000' }] },
      console: { ports: [{ target: 8080, published: '5174' }] },
      seed: {},
    },
  };
  const raw = {
    services: {
      api: { ports: ['${API_PORT:-3000}:3000'] },
      console: { ports: ['${CONSOLE_PORT:-5173}:8080'] },
      seed: {},
    },
  };

  it("reads each service's host port and the variable that sets it", () => {
    expect(publishedPorts(resolved, raw)).toEqual([
      { service: 'api', port: 3000, variable: 'API_PORT' },
      { service: 'console', port: 5174, variable: 'CONSOLE_PORT' },
    ]);
  });

  it('reads a long-syntax port and a fixed one without a variable', () => {
    expect(
      publishedPorts(
        { services: { db: { ports: [{ target: 5432, published: 5433 }] } } },
        {
          services: {
            db: { ports: [{ target: 5432, published: '${POSTGRES_PORT}' }] },
          },
        },
      ),
    ).toEqual([{ service: 'db', port: 5433, variable: 'POSTGRES_PORT' }]);
    expect(
      publishedPorts(
        { services: { db: { ports: [{ target: 5432, published: '5433' }] } } },
        { services: { db: { ports: ['5433:5432'] } } },
      ),
    ).toEqual([{ service: 'db', port: 5433, variable: undefined }]);
  });
});

describe('portCheck', () => {
  const port = { service: 'console', port: 5173, variable: 'CONSOLE_PORT' };

  it('passes a free port', () => {
    expect(portCheck(port, 'free', 'fintech-agent').level).toBe('pass');
  });

  it('notes a port this stack already holds, without failing', () => {
    const check = portCheck(port, 'own', 'fintech-agent');
    expect(check.level).toBe('note');
    expect(check.text).toMatch(/fintech-agent.*already running/);
  });

  it('fails a port another program holds and names the variable to move it', () => {
    const check = portCheck(port, 'busy', 'fintech-agent');
    expect(check.level).toBe('fail');
    expect(check.fix).toContain('CONSOLE_PORT');
  });
});

describe('parsePs', () => {
  const API = {
    Service: 'api',
    State: 'running',
    Health: 'healthy',
    ExitCode: 0,
    Publishers: [{ PublishedPort: 3000 }],
  };
  const SEED = {
    Service: 'seed',
    State: 'exited',
    Health: '',
    ExitCode: 0,
    Publishers: null,
  };

  it('reads JSON Lines, as Compose prints them now', () => {
    expect(
      parsePs(`${JSON.stringify(API)}\n${JSON.stringify(SEED)}\n`),
    ).toHaveLength(2);
  });

  it('reads the JSON array older Compose printed', () => {
    expect(parsePs(JSON.stringify([API, SEED]))).toHaveLength(2);
  });

  it('reads nothing as no containers', () => {
    expect(parsePs('')).toEqual([]);
    expect(parsePs('\n')).toEqual([]);
  });

  it('collects the host ports only running containers hold', () => {
    const stopped = {
      ...API,
      State: 'exited',
      Publishers: [{ PublishedPort: 5173 }],
    };
    expect([...heldPorts([API, stopped, SEED])]).toEqual([3000]);
  });

  it('names the running services', () => {
    expect(runningServices(parsePs(JSON.stringify([API, SEED])))).toEqual([
      'api',
    ]);
  });
});

describe('failingServices', () => {
  const row = (over: object) => ({
    Service: 'x',
    State: 'running',
    Health: 'healthy',
    ExitCode: 0,
    Publishers: null,
    ...over,
  });

  it('names crashed, unhealthy and restarting services, not a seed that finished', () => {
    expect(
      failingServices([
        row({ Service: 'seed', State: 'exited', ExitCode: 0 }),
        row({ Service: 'api', Health: 'unhealthy' }),
        row({ Service: 'mcp', State: 'exited', ExitCode: 1 }),
        row({ Service: 'executor', State: 'restarting' }),
        row({ Service: 'console', State: 'created', Health: '' }),
      ]),
    ).toEqual(['api', 'mcp', 'executor']);
  });
});

describe('agentStatusText', () => {
  it('ties each state to what the console shows', () => {
    expect(agentStatusText('off')).toContain('El agente está apagado');
    expect(agentStatusText('off')).toContain('AGENT_MODE=off');
    expect(agentStatusText('no_api_key')).toContain(
      'El agente no tiene clave de API',
    );
    expect(agentStatusText('no_api_key')).toContain('ANTHROPIC_API_KEY');
    expect(agentStatusText('on')).toMatch(/^on/);
  });

  it('explains exactly the states the api reports', () => {
    expect(Object.keys(AGENT_STATUS).sort()).toEqual([...AGENT_STATES].sort());
  });
});

describe('parseNetworks', () => {
  it('reads docker network inspect: name, compose project and subnets', () => {
    const inspected = JSON.stringify([
      {
        Name: 'fintech-agent_default',
        IPAM: {
          Config: [
            { Subnet: '10.231.0.0/24', IPRange: '10.231.0.128/25' },
            { Subnet: 'fd00::/64' },
          ],
        },
        Labels: { 'com.docker.compose.project': 'fintech-agent' },
      },
      { Name: 'host', IPAM: { Config: null }, Labels: {} },
    ]);
    expect(parseNetworks(inspected)).toEqual([
      {
        name: 'fintech-agent_default',
        project: 'fintech-agent',
        subnets: ['10.231.0.0/24', 'fd00::/64'],
      },
      { name: 'host', project: undefined, subnets: [] },
    ]);
  });

  it('refuses output that is not an array', () => {
    expect(() => parseNetworks('{}')).toThrow();
  });
});

describe('parseComposeConfig and stackSubnet', () => {
  const CONFIG = {
    name: 'fintech-agent',
    services: { api: { ports: [{ target: 3000, published: '3000' }] } },
    networks: {
      default: {
        name: 'fintech-agent_default',
        ipam: {
          config: [{ subnet: '10.231.0.0/24', ip_range: '10.231.0.128/25' }],
        },
      },
    },
  };

  it('reads the project name, services and the default network subnet', () => {
    const config = parseComposeConfig(JSON.stringify(CONFIG));
    expect(config.name).toBe('fintech-agent');
    expect(Object.keys(config.services)).toEqual(['api']);
    expect(stackSubnet(config)).toBe('10.231.0.0/24');
  });

  it('has no subnet when the default network pins none', () => {
    const config = parseComposeConfig(
      JSON.stringify({ name: 'x', services: {} }),
    );
    expect(stackSubnet(config)).toBeUndefined();
  });

  it('refuses output without a project name or services', () => {
    expect(() => parseComposeConfig('{"services":{}}')).toThrow();
    expect(() => parseComposeConfig('{"name":"x"}')).toThrow();
  });
});
