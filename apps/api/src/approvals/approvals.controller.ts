import {
  ActionIdSchema,
  DECISION_FAILURE,
  DecisionSchema,
  type Decision,
} from '@fintech-agent/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { failureException } from '../common/http/failure-status.js';
import { requestMeta } from '../common/http/request-meta.js';
import { INPUT_PART, ZodPipe } from '../common/http/zod.pipe.js';
import { CurrentOperator, OperatorGuard } from '../operators/operator.guard.js';
import type { Operator } from '../operators/operator-tokens.js';
import {
  decide,
  DecisionError,
  type DecideDeps,
  type DecisionResult,
} from './decide.js';

export const DECIDE_DEPS = 'DECIDE_DEPS';

/** `POST /actions/:actionId/decision`: an operator approves or rejects a proposal (02 G3). */
@Controller('actions')
@UseGuards(OperatorGuard)
export class ApprovalsController {
  private readonly logger = new Logger(ApprovalsController.name);

  constructor(@Inject(DECIDE_DEPS) private readonly deps: DecideDeps) {}

  @Post(':actionId/decision')
  @HttpCode(HttpStatus.OK)
  async decide(
    @Param('actionId', new ZodPipe(ActionIdSchema, INPUT_PART.path))
    actionId: string,
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
      if (error instanceof DecisionError) {
        if (error.failure === DECISION_FAILURE.coreUnavailable) {
          this.logger.warn({ event: 'core_unavailable', action_id: actionId });
        }
        throw failureException(
          error.failure,
          error.codes.length > 0 ? { codes: error.codes } : {},
        );
      }
      throw error;
    }
  }
}
