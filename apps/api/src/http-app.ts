import type { NestExpressApplication } from '@nestjs/platform-express';

import { GlobalExceptionFilter } from './common/filters/http-exception.filter.js';

const MAX_BODY = '32kb';

/**
 * What `NestFactory.create` needs for this api: the raw bytes kept beside the
 * parsed body, because a webhook signature covers the bytes as sent.
 */
export const HTTP_APP_OPTIONS = { rawBody: true } as const;

/** The filter and the 32 KB body limit (01) every `api` instance runs with, tests included. */
export function configureHttpApp(app: NestExpressApplication): void {
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useBodyParser('json', { limit: MAX_BODY });
  // Nest also parses forms by default, at 100 KB; the limit binds every parser.
  app.useBodyParser('urlencoded', { limit: MAX_BODY, extended: false });
}
