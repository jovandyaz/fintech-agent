import { parseWebhookSecrets } from '@fintech-agent/contracts';
import { Module, type DynamicModule } from '@nestjs/common';

import type { ApiConfig } from '../config.js';
import { DATABASE, type Database } from '../database/index.js';
import {
  WEBHOOK_DEPS,
  WebhooksController,
  type WebhookDeps,
} from './webhooks.controller.js';

/** The ticket webhook (01 §Webhook and queue). */
@Module({})
export class WebhooksModule {
  static register(config: ApiConfig): DynamicModule {
    const secrets = parseWebhookSecrets(config.WEBHOOK_SECRET);
    return {
      module: WebhooksModule,
      controllers: [WebhooksController],
      providers: [
        {
          provide: WEBHOOK_DEPS,
          inject: [DATABASE],
          useFactory: (db: Database): WebhookDeps => ({
            db,
            secrets,
            now: () => new Date(),
          }),
        },
      ],
    };
  }
}
