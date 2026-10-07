import { CaseIdSchema } from '@fintech-agent/contracts';
import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { failureException } from '../common/http/failure-status.js';
import { requestMeta } from '../common/http/request-meta.js';
import { ZodPipe } from '../common/http/zod.pipe.js';
import { CurrentOperator, OperatorGuard } from '../operators/operator.guard.js';
import type { Operator } from '../operators/operator-tokens.js';
import {
  RerunError,
  rerunCase,
  type RerunDeps,
  type RerunResult,
} from './rerun.js';

export const RERUN_DEPS = 'RERUN_DEPS';

/** `POST /cases/:caseId/rerun`: an operator sends a case back to the agent (02 G3). */
@Controller('cases')
@UseGuards(OperatorGuard)
export class CasesController {
  constructor(@Inject(RERUN_DEPS) private readonly deps: RerunDeps) {}

  @Post(':caseId/rerun')
  @HttpCode(HttpStatus.OK)
  async rerun(
    @Param('caseId', new ZodPipe(CaseIdSchema)) caseId: string,
    @CurrentOperator() operator: Operator,
    @Req() request: Request,
  ): Promise<RerunResult> {
    try {
      return await rerunCase(this.deps, {
        caseId,
        operator,
        meta: requestMeta(request),
      });
    } catch (error) {
      if (error instanceof RerunError) throw failureException(error.failure);
      throw error;
    }
  }
}
