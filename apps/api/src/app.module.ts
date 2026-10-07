import { Module, type DynamicModule } from '@nestjs/common';

import { ApprovalsModule } from './approvals/approvals.module.js';
import type { ApiConfig } from './config.js';
import { DatabaseModule } from './database/index.js';
import { HealthController } from './health.controller.js';

@Module({})
export class AppModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DatabaseModule.forRoot(config.API_DATABASE_URL),
        ApprovalsModule.register(config),
      ],
      controllers: [HealthController],
    };
  }
}
