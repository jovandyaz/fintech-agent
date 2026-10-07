import { createCoreClient } from '@fintech-agent/contracts';
import { Module, type DynamicModule } from '@nestjs/common';

import type { ApiConfig } from '../config.js';
import { DATABASE, type Database } from '../database/index.js';
import { ApprovalsController, DECIDE_DEPS } from './approvals.controller.js';
import type { DecideDeps } from './decide.js';
import { OPERATOR_CREDENTIALS, OperatorGuard } from './operator.guard.js';
import { parseOperatorTokens } from './operator-tokens.js';

/** core-mock read access for override ownership; never handed to the agent module. */
export const CORE_CLIENT = 'CORE_CLIENT';

/** Operator identity and the decision API (02 G3). */
@Module({})
export class ApprovalsModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: ApprovalsModule,
      controllers: [ApprovalsController],
      providers: [
        OperatorGuard,
        {
          provide: OPERATOR_CREDENTIALS,
          useValue: parseOperatorTokens(config.OPERATOR_TOKENS),
        },
        {
          provide: CORE_CLIENT,
          useFactory: () =>
            createCoreClient({
              baseUrl: config.CORE_MOCK_URL,
              readKey: config.CORE_READ_KEY,
              fetch,
            }),
        },
        {
          provide: DECIDE_DEPS,
          inject: [DATABASE, CORE_CLIENT],
          useFactory: (db: Database, core: DecideDeps['core']): DecideDeps => ({
            db,
            core,
            now: () => new Date(),
          }),
        },
      ],
      exports: [OPERATOR_CREDENTIALS, OperatorGuard],
    };
  }
}
