import { createCoreClient } from '@fintech-agent/contracts';
import { Module, type DynamicModule, type Provider } from '@nestjs/common';

import type { ApiConfig } from '../config.js';
import { DATABASE, type Database } from '../database/index.js';
import { ApprovalsController, DECIDE_DEPS } from './approvals.controller.js';
import type { DecideDeps } from './decide.js';

/** core-mock read access for override ownership and the console; never handed to the agent module. */
export const CORE_CLIENT = 'CORE_CLIENT';

/** The core-mock read client under `CORE_CLIENT`, for each module that reads core-mock. */
export const coreClientProvider = (config: ApiConfig): Provider => ({
  provide: CORE_CLIENT,
  useFactory: () =>
    createCoreClient({
      baseUrl: config.CORE_MOCK_URL,
      readKey: config.CORE_READ_KEY,
      fetch,
    }),
});

/** The decision API (02 G3). */
@Module({})
export class ApprovalsModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: ApprovalsModule,
      controllers: [ApprovalsController],
      providers: [
        coreClientProvider(config),
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
    };
  }
}
