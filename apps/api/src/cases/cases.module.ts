import { Module } from '@nestjs/common';

import { CasesController } from './cases.controller.js';

/** Case operations for the console; re-runs for now (02 G3). */
@Module({ controllers: [CasesController] })
export class CasesModule {}
