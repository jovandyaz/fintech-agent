import type { NestExpressApplication } from '@nestjs/platform-express';
import { describe, expect, it, vi } from 'vitest';

import { GlobalExceptionFilter } from './common/filters/http-exception.filter.js';
import { HTTP_APP_OPTIONS, configureHttpApp } from './http-app.js';

const appDouble = () => {
  const calls = {
    useGlobalFilters: vi.fn(),
    useBodyParser: vi.fn(),
    set: vi.fn(),
  };
  return { calls, app: calls as unknown as NestExpressApplication };
};

describe('configureHttpApp', () => {
  it('registers the masking exception filter and the 32 KB body limit', () => {
    const {
      app,
      calls: { useGlobalFilters, useBodyParser },
    } = appDouble();
    configureHttpApp(app, { trustProxy: '' });
    expect(useGlobalFilters).toHaveBeenCalledWith(
      expect.any(GlobalExceptionFilter),
    );
    expect(useBodyParser).toHaveBeenCalledWith('json', { limit: '32kb' });
    expect(useBodyParser).toHaveBeenCalledWith('urlencoded', {
      limit: '32kb',
      extended: false,
    });
  });

  it('trusts only the configured proxy address for the client address', () => {
    const { app, calls } = appDouble();
    configureHttpApp(app, { trustProxy: '10.231.0.10' });
    expect(calls.set).toHaveBeenCalledWith('trust proxy', '10.231.0.10');
  });

  it('trusts no proxy when none is configured', () => {
    const { app, calls } = appDouble();
    configureHttpApp(app, { trustProxy: '' });
    expect(calls.set).toHaveBeenCalledWith('trust proxy', false);
  });

  it('keeps the raw body a webhook signature is computed over', () => {
    expect(HTTP_APP_OPTIONS).toEqual({ rawBody: true });
  });
});
