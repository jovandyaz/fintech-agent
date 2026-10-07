import { createServer, type Server } from 'node:http';

import {
  CaseTokenClaimsSchema,
  maskPii,
  redactCredentials,
} from '@fintech-agent/contracts';
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  McpServer,
  originValidationResponse,
} from '@modelcontextprotocol/server';
import {
  toNodeHandler,
  type NodeIncomingMessageLike,
} from '@modelcontextprotocol/node';

import { verifyCaseToken } from './case-token.js';
import { createCoreClient, type FetchLike } from './core-client.js';
import type { SecurityEventSink } from './security-events.js';
import { createCallBudget, registerTools } from './tools.js';

const MIN_KEY_BYTES = 32;
const MAX_BODY_BYTES = 64 * 1024;
const MCP_PATH = '/mcp';
const HEALTH_PATH = '/health';
const SERVER_INFO = { name: 'case-copilot-mcp', version: '1.0.0' } as const;
const STATUS = { ok: 200, unauthorized: 401, notFound: 404 } as const;
const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i;
const CHALLENGE = {
  missing: 'Bearer',
  invalid: 'Bearer error="invalid_token"',
} as const;
const REFUSAL = {
  host: 'host',
  origin: 'origin',
  missingToken: 'missing_token',
  invalidToken: 'invalid_token',
} as const;
type Refusal = (typeof REFUSAL)[keyof typeof REFUSAL];

export interface McpAppOptions {
  coreUrl: string;
  coreReadKey: string;
  caseTokenKey: string;
  /** The server's canonical URL; the token's `aud` must equal it, whatever URL the client dialed (02 G4). */
  audience: string;
  /** Extra hostnames clients may dial besides the audience host and loopback, e.g. the compose service name. */
  allowedHosts?: string[];
  securityEvents: SecurityEventSink;
  fetch?: FetchLike;
  log?: (line: Record<string, unknown>) => void;
}

export interface McpApp {
  server: Server;
}

const json = (status: number, body: unknown, headers = {}): Response =>
  Response.json(body, { status, headers });

const unauthorized = (challenge: string): Response =>
  json(
    STATUS.unauthorized,
    { error: 'unauthorized' },
    { 'www-authenticate': challenge },
  );

/**
 * The MCP server: verifies the case token on every request, then serves the
 * four read-only tools from a server built per request for that token's
 * customer. The token is never forwarded; core-mock is read with the server's
 * own key.
 */
export function createMcpApp(options: McpAppOptions): McpApp {
  const key = new TextEncoder().encode(options.caseTokenKey);
  if (key.byteLength < MIN_KEY_BYTES) {
    throw new Error(`CASE_TOKEN_KEY must be at least ${MIN_KEY_BYTES} bytes`);
  }
  const log = options.log ?? ((line) => console.log(JSON.stringify(line)));
  const core = createCoreClient({
    baseUrl: options.coreUrl,
    readKey: options.coreReadKey,
    fetch: options.fetch ?? fetch,
  });
  const calls = createCallBudget();
  const transportOptions = {
    maxRequestBodySize: MAX_BODY_BYTES,
    // SDK messages echo request values such as headers, so they are masked (G6).
    onerror: (error: Error) =>
      log({
        event: 'mcp_error',
        message: maskPii(redactCredentials(error.message)),
      }),
  };
  // DNS-rebinding guard: the SDK handler validates neither header.
  const allowedHosts = [
    new URL(options.audience).hostname,
    ...(options.allowedHosts ?? []),
    ...localhostAllowedHostnames(),
  ];

  const handler = createMcpHandler(({ authInfo }) => {
    const claims = CaseTokenClaimsSchema.parse(authInfo?.extra?.claims);
    const server = new McpServer(SERVER_INFO);
    registerTools(server, {
      claims,
      core,
      securityEvents: options.securityEvents,
      calls,
      log,
    });
    return server;
  }, transportOptions);

  // The reason only: header values and tokens are caller-chosen (G6).
  const refuse = (reason: Refusal, response: Response): Response => {
    log({ event: 'auth_rejected', reason });
    return response;
  };

  async function serve(request: Request): Promise<Response> {
    const badHost = hostHeaderValidationResponse(request, allowedHosts);
    if (badHost) return refuse(REFUSAL.host, badHost);
    const badOrigin = originValidationResponse(request, allowedHosts);
    if (badOrigin) return refuse(REFUSAL.origin, badOrigin);
    const { pathname } = new URL(request.url);
    if (pathname === HEALTH_PATH && request.method === 'GET') {
      return json(STATUS.ok, { status: 'ok' });
    }
    if (pathname !== MCP_PATH)
      return json(STATUS.notFound, { error: 'not_found' });
    const match = BEARER.exec(request.headers.get('authorization') ?? '');
    if (!match?.[1]) {
      return refuse(REFUSAL.missingToken, unauthorized(CHALLENGE.missing));
    }
    const token = match[1];
    const claims = await verifyCaseToken(token, key, options.audience);
    if (claims === null) {
      return refuse(REFUSAL.invalidToken, unauthorized(CHALLENGE.invalid));
    }
    return handler.fetch(request, {
      authInfo: {
        token,
        clientId: claims.case_id,
        scopes: [claims.scope],
        expiresAt: claims.exp,
        extra: { claims },
      },
    });
  }

  const node = toNodeHandler({ fetch: serve }, transportOptions);
  const server = createServer((req, res) => {
    // Node always sets `method` on a server request; the SDK's duck type only
    // rejects IncomingMessage under exactOptionalPropertyTypes.
    void node(req as NodeIncomingMessageLike, res);
  });
  return { server };
}
