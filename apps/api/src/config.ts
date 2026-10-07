import { z } from 'zod';

const DEFAULT_API_PORT = 3000;

const ApiConfigSchema = z.object({
  API_DATABASE_URL: z.url(),
  API_PORT: z.coerce.number().int().positive().default(DEFAULT_API_PORT),
});

export type ApiConfig = z.infer<typeof ApiConfigSchema>;

/** Read once at boot; a missing or malformed variable stops the process. */
export const loadApiConfig = (env: NodeJS.ProcessEnv): ApiConfig =>
  ApiConfigSchema.parse(env);
