import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
  type HttpException,
} from '@nestjs/common';
import { DecisionSchema, type Decision } from '@fintech-agent/contracts';
import type { Request } from 'express';

import { requestMeta } from '../common/http/request-meta.js';
import { ZodPipe } from '../common/http/zod.pipe.js';
import {
  decide,
  DECISION_FAILURE,
  DecisionError,
  type DecideDeps,
  type DecisionFailure,
  type DecisionResult,
} from './decide.js';
import { CurrentOperator, OperatorGuard } from '../operators/operator.guard.js';
import type { Operator } from '../operators/operator-tokens.js';

export const DECIDE_DEPS = 'DECIDE_DEPS';

const HTTP_ERROR: Record<
  DecisionFailure,
  (error: DecisionError) => HttpException
> = {
  [DECISION_FAILURE.notFound]: () => new NotFoundException(),
  [DECISION_FAILURE.conflict]: () => new ConflictException(),
  [DECISION_FAILURE.invalidReply]: ({ failure, codes }) =>
    new BadRequestException({ message: failure, codes }),
  [DECISION_FAILURE.piiInRejectReason]: ({ failure }) =>
    new BadRequestException({ message: failure }),
  [DECISION_FAILURE.flagsNotAcknowledged]: ({ failure }) =>
    new BadRequestException({ message: failure }),
  [DECISION_FAILURE.overrideNotAllowed]: ({ failure }) =>
    new BadRequestException({ message: failure }),
  [DECISION_FAILURE.transactionsNotReviewed]: ({ failure }) =>
    new BadRequestException({ message: failure }),
  [DECISION_FAILURE.coreUnavailable]: () => new ServiceUnavailableException(),
};

/** `POST /actions/:actionId/decision`: an operator approves or rejects a proposal (02 G3). */
@Controller('actions')
@UseGuards(OperatorGuard)
export class ApprovalsController {
  constructor(@Inject(DECIDE_DEPS) private readonly deps: DecideDeps) {}

  @Post(':actionId/decision')
  @HttpCode(HttpStatus.OK)
  async decide(
    @Param('actionId') actionId: string,
    @Body(new ZodPipe(DecisionSchema)) decision: Decision,
    @CurrentOperator() operator: Operator,
    @Req() request: Request,
  ): Promise<DecisionResult> {
    try {
      return await decide(this.deps, {
        actionId,
        decision,
        operator,
        meta: requestMeta(request),
      });
    } catch (error) {
      if (error instanceof DecisionError)
        throw HTTP_ERROR[error.failure](error);
      throw error;
    }
  }
}
