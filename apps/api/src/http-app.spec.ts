import type { NestExpressApplication } from '@nestjs/platform-express';
import { describe, expect, it, vi } from 'vitest';

import { GlobalExceptionFilter } from './common/filters/http-exception.filter.js';
import { HTTP_APP_OPTIONS, configureHttpApp } from './http-app.js';

describe('configureHttpApp', () => {
  it('registers the masking exception filter and the 32 KB body limit', () => {
    const useGlobalFilters = vi.fn();
    const useBodyParser = vi.fn();
    configureHttpApp({
      useGlobalFilters,
      useBodyParser,
    } as unknown as NestExpressApplication);
    expect(useGlobalFilters).toHaveBeenCalledWith(
      expect.any(GlobalExceptionFilter),
    );
    expect(useBodyParser).toHaveBeenCalledWith('json', { limit: '32kb' });
    expect(useBodyParser).toHaveBeenCalledWith('urlencoded', {
      limit: '32kb',
      extended: false,
    });
  });

  it('keeps the raw body a webhook signature is computed over', () => {
    expect(HTTP_APP_OPTIONS).toEqual({ rawBody: true });
  });
});
