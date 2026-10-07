import { z } from 'zod';

const DEFAULT_MCP_PORT = 3020;

const McpConfigSchema = z.object({
  CORE_MOCK_URL: z.url(),
  CORE_READ_KEY: z.string().min(1),
  CASE_TOKEN_KEY: z.string().min(1),
  MCP_AUDIENCE: z.url(),
  MCP_DATABASE_URL: z.url(),
  MCP_ALLOWED_HOSTS: z
    .string()
    .default('')
    .transform((hosts) =>
      hosts
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean),
    ),
  MCP_PORT: z.coerce.number().int().positive().default(DEFAULT_MCP_PORT),
});

export type McpConfig = z.infer<typeof McpConfigSchema>;

/** Read once at boot; a missing or malformed variable stops the process. */
export const loadMcpConfig = (env: NodeJS.ProcessEnv): McpConfig =>
  McpConfigSchema.parse(env);
