import postgres from 'postgres';

import { createMcpApp } from './app.js';
import { createPostgresSecurityEventSink } from './security-events.js';

const DEFAULT_PORT = 3020;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const log = (line: Record<string, unknown>): void => {
  console.log(JSON.stringify(line));
};

const app = createMcpApp({
  coreUrl: required('CORE_MOCK_URL'),
  coreReadKey: required('CORE_READ_KEY'),
  caseTokenKey: required('CASE_TOKEN_KEY'),
  audience: required('MCP_AUDIENCE'),
  allowedHosts: (process.env.MCP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean),
  securityEvents: createPostgresSecurityEventSink(
    postgres(required('MCP_DATABASE_URL'), { onnotice: () => undefined }),
  ),
  log,
});

const port = Number(process.env.MCP_PORT ?? DEFAULT_PORT);
app.server.listen(port, () => {
  log({ event: 'mcp_listening', port });
});

const shutdown = (): void => {
  app.server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
