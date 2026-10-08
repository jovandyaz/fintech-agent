import { Module, type DynamicModule } from '@nestjs/common';

import { AgentWorkerModule } from './agent/agent-worker.module.js';
import { agentConfigOf } from './agent/core/deps.js';
import { ApprovalsModule } from './approvals/approvals.module.js';
import { CasesModule } from './cases/cases.module.js';
import type { ApiConfig } from './config.js';
import { DatabaseModule } from './database/index.js';
import { OperatorsModule } from './operators/operators.module.js';
import { HealthController } from './health.controller.js';

@Module({})
export class AppModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DatabaseModule.forRoot(config.API_DATABASE_URL),
        OperatorsModule.register(config.OPERATOR_TOKENS),
        ApprovalsModule.register(config),
        CasesModule,
        ...(config.AGENT_WORKER === 'on'
          ? [AgentWorkerModule.register(agentConfigOf(config))]
          : []),
      ],
      controllers: [HealthController],
    };
  }
}
