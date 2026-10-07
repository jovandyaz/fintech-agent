import { Module } from '@nestjs/common';

import { DATABASE, type Database } from '../database/index.js';
import { CasesController, RERUN_DEPS } from './cases.controller.js';
import type { RerunDeps } from './rerun.js';

/** Case operations for the console; re-runs for now (02 G3). */
@Module({
  controllers: [CasesController],
  providers: [
    {
      provide: RERUN_DEPS,
      inject: [DATABASE],
      useFactory: (db: Database): RerunDeps => ({ db, now: () => new Date() }),
    },
  ],
})
export class CasesModule {}
