import {
  CaseDetailSchema,
  CaseIdSchema,
  CoreUnavailableError,
  InboxItemSchema,
  InboxQuerySchema,
  type AgentState,
  type CaseDetail,
  type CoreClient,
  type CustomerOption,
  type InboxItem,
  type InboxQuery,
  type OperatorView,
  type Status,
} from '@fintech-agent/contracts';
import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';

import { failureException } from '../common/http/failure-status.js';
import { INPUT_PART, ZodPipe } from '../common/http/zod.pipe.js';
import type { Database } from '../database/index.js';
import { CurrentOperator, OperatorGuard } from '../operators/operator.guard.js';
import type { Operator } from '../operators/operator-tokens.js';
import { caseDetailOf, inboxOf } from './read-model.js';

/** The provider of what the console's reads need. */
export const CONSOLE_DEPS = 'CONSOLE_DEPS';

/** The database, the core-mock read client and the agent's state, fixed at boot. */
export interface ConsoleDeps {
  db: Database;
  core: Pick<CoreClient, 'customerOptions' | 'transaction' | 'transactions'>;
  agent: AgentState;
}

/**
 * What the ops console reads (04 Step 7), every route behind an operator
 * token (02 G3). Each answer is parsed against its strict contracts DTO on
 * the way out, so a canary reads like a real case until it is decided.
 */
@Controller()
@UseGuards(OperatorGuard)
export class ConsoleController {
  constructor(@Inject(CONSOLE_DEPS) private readonly deps: ConsoleDeps) {}

  @Get('me')
  me(@CurrentOperator() operator: Operator): OperatorView {
    return { id: operator.id };
  }

  @Get('status')
  status(): Status {
    return { agent: this.deps.agent };
  }

  @Get('customers')
  async customers(): Promise<CustomerOption[]> {
    try {
      return await this.deps.core.customerOptions();
    } catch (error) {
      if (error instanceof CoreUnavailableError) {
        throw failureException('core_unavailable');
      }
      throw error;
    }
  }

  @Get('cases')
  async inbox(
    @Query(new ZodPipe(InboxQuerySchema, INPUT_PART.query)) query: InboxQuery,
  ): Promise<InboxItem[]> {
    return InboxItemSchema.array().parse(
      await inboxOf(this.deps.db, { includeEval: query.include_eval }),
    );
  }

  @Get('cases/:caseId')
  async detail(
    @Param('caseId', new ZodPipe(CaseIdSchema, INPUT_PART.path)) caseId: string,
  ): Promise<CaseDetail> {
    const detail = await caseDetailOf(this.deps, caseId);
    if (!detail) throw failureException('not_found');
    return CaseDetailSchema.parse(detail);
  }
}
