import { bootFailureLine } from '@fintech-agent/contracts';
import postgres from 'postgres';

import { createMcpApp } from './app.js';
import { loadMcpConfig } from './config.js';
import { createPostgresSecurityEventSink } from './security-events.js';

const DB_CONNECT_TIMEOUT_S = 2;

const log = (line: Record<string, unknown>): void => {
  console.log(JSON.stringify(line));
};

function failBoot(error: unknown): void {
  process.stderr.write(`${bootFailureLine(error)}\n`);
  process.exitCode = 1;
}

function start(): void {
  const config = loadMcpConfig(process.env);
  const app = createMcpApp({
    coreUrl: config.CORE_MOCK_URL,
    coreReadKey: config.CORE_READ_KEY,
    caseTokenKey: config.CASE_TOKEN_KEY,
    audience: config.MCP_AUDIENCE,
    allowedHosts: config.MCP_ALLOWED_HOSTS,
    securityEvents: createPostgresSecurityEventSink(
      postgres(config.MCP_DATABASE_URL, {
        connect_timeout: DB_CONNECT_TIMEOUT_S,
        onnotice: () => undefined,
      }),
    ),
    log,
  });

  // listen() reports a taken port as an event, after start() has returned.
  app.server.once('error', failBoot);
  app.server.listen(config.MCP_PORT, () => {
    log({ event: 'mcp_listening', port: config.MCP_PORT });
  });

  const shutdown = (): void => {
    app.server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

try {
  start();
} catch (error) {
  failBoot(error);
}
