import {
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
  type HttpException,
} from '@nestjs/common';
import type { Request } from 'express';

import { requestMeta } from '../common/http/request-meta.js';
import { DATABASE, type Database } from '../database/index.js';
import { CurrentOperator, OperatorGuard } from '../operators/operator.guard.js';
import type { Operator } from '../operators/operator-tokens.js';
import {
  RERUN_FAILURE,
  RerunError,
  rerunCase,
  type RerunFailure,
  type RerunResult,
} from './rerun.js';

const HTTP_ERROR: Record<RerunFailure, () => HttpException> = {
  [RERUN_FAILURE.notFound]: () => new NotFoundException(),
  [RERUN_FAILURE.conflict]: () => new ConflictException(),
};

/** `POST /cases/:caseId/rerun`: an operator sends a case back to the agent (02 G3). */
@Controller('cases')
@UseGuards(OperatorGuard)
export class CasesController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Post(':caseId/rerun')
  @HttpCode(HttpStatus.OK)
  async rerun(
    @Param('caseId') caseId: string,
    @CurrentOperator() operator: Operator,
    @Req() request: Request,
  ): Promise<RerunResult> {
    try {
      return await rerunCase(
        { db: this.db, now: () => new Date() },
        { caseId, operator, meta: requestMeta(request) },
      );
    } catch (error) {
      if (error instanceof RerunError) throw HTTP_ERROR[error.failure]();
      throw error;
    }
  }
}
