import type { Request } from 'express';

/** The caller's address and user agent, as `audit_log` records them (02 G3). */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export const requestMeta = (request: Request): RequestMeta => ({
  ip: request.ip ?? null,
  userAgent: request.headers['user-agent'] ?? null,
});
