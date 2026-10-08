import type { CoreClient } from '@fintech-agent/contracts';
import { Module, type DynamicModule } from '@nestjs/common';

import {
  CORE_CLIENT,
  coreClientProvider,
} from '../approvals/approvals.module.js';
import type { ApiConfig } from '../config.js';
import { DATABASE, type Database } from '../database/index.js';
import { agentStateOf } from './agent-state.js';
import {
  CONSOLE_DEPS,
  ConsoleController,
  type ConsoleDeps,
} from './console.controller.js';

/** The ops console's read API (04 Step 7). */
@Module({})
export class ConsoleModule {
  static register(config: ApiConfig): DynamicModule {
    const agent = agentStateOf(config);
    return {
      module: ConsoleModule,
      controllers: [ConsoleController],
      providers: [
        coreClientProvider(config),
        {
          provide: CONSOLE_DEPS,
          inject: [DATABASE, CORE_CLIENT],
          useFactory: (db: Database, core: CoreClient): ConsoleDeps => ({
            db,
            core,
            agent,
          }),
        },
      ],
    };
  }
}
