import type { Request } from 'express';

/** The caller's address and user agent, as `audit_log` records them (02 G3). */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

// A dual-stack socket reports an IPv4 peer as ::ffff:a.b.c.d; the audit keeps
// one form, so one operator's decisions read as one address.
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export const requestMeta = (request: Request): RequestMeta => ({
  ip: request.ip?.replace(IPV4_MAPPED, '$1') ?? null,
  userAgent: request.headers['user-agent'] ?? null,
});
