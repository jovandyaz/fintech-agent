import { parseWebhookSecrets } from '@fintech-agent/contracts';
import { Module, type DynamicModule } from '@nestjs/common';

import type { ApiConfig } from '../config.js';
import { DATABASE, type Database } from '../database/index.js';
import { ConsoleCasesController } from './console-cases.controller.js';
import { WEBHOOK_DEPS, type WebhookDeps } from './delivery.js';
import { WebhooksController } from './webhooks.controller.js';

/** How cases come in (01 §Webhook and queue): the ticket webhook and the console form. */
@Module({})
export class WebhooksModule {
  static register(config: ApiConfig): DynamicModule {
    const secrets = parseWebhookSecrets(config.WEBHOOK_SECRET);
    return {
      module: WebhooksModule,
      controllers: [WebhooksController, ConsoleCasesController],
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
