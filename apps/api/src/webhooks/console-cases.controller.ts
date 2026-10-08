import {
  NewCaseSchema,
  type CaseAcknowledgment,
  type NewCase,
} from '@fintech-agent/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { requestMeta } from '../common/http/request-meta.js';
import { ZodPipe } from '../common/http/zod.pipe.js';
import { CurrentOperator, OperatorGuard } from '../operators/operator.guard.js';
import type { Operator } from '../operators/operator-tokens.js';
import { WEBHOOK_DEPS, openConsoleCase, type WebhookDeps } from './delivery.js';

/**
 * `POST /cases`, the console's new case form (01): a signed-in operator
 * names the customer and the text; the case takes the webhook's path. A
 * refusal here would be a bug in this API, so it is answered as a 500.
 */
@Controller('cases')
@UseGuards(OperatorGuard)
export class ConsoleCasesController {
  constructor(@Inject(WEBHOOK_DEPS) private readonly deps: WebhookDeps) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async open(
    @Body(new ZodPipe(NewCaseSchema)) form: NewCase,
    @CurrentOperator() operator: Operator,
    @Req() request: Request,
  ): Promise<CaseAcknowledgment> {
    const { case_id, folio } = await openConsoleCase(this.deps, {
      form,
      operator,
      meta: requestMeta(request),
    });
    return { case_id, folio };
  }
}
