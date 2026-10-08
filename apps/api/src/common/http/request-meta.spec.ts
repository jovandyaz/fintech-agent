import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { requestMeta } from './request-meta.js';

const requestFrom = (ip: string | undefined, userAgent?: string): Request =>
  ({
    ip,
    headers: userAgent === undefined ? {} : { 'user-agent': userAgent },
  }) as unknown as Request;

describe('requestMeta (02 G3: the audit records where a decision came from)', () => {
  it('records an IPv4 client in one form, whether the socket saw it mapped or not', () => {
    expect(requestMeta(requestFrom('::ffff:192.168.65.1')).ip).toBe(
      '192.168.65.1',
    );
    expect(requestMeta(requestFrom('192.168.65.1')).ip).toBe('192.168.65.1');
  });

  it('keeps an IPv6 client as it is', () => {
    expect(requestMeta(requestFrom('2001:db8::7')).ip).toBe('2001:db8::7');
  });

  it('records nothing it did not see', () => {
    expect(requestMeta(requestFrom(undefined))).toEqual({
      ip: null,
      userAgent: null,
    });
  });
});
