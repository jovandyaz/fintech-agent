import { HttpException, HttpStatus } from '@nestjs/common';

import type { DecisionFailure } from '../../approvals/decide.js';
import type { RerunFailure } from '../../cases/rerun.js';

const FAILURE_STATUS: Record<DecisionFailure | RerunFailure, HttpStatus> = {
  not_found: HttpStatus.NOT_FOUND,
  conflict: HttpStatus.CONFLICT,
  invalid_reply: HttpStatus.BAD_REQUEST,
  pii_in_reject_reason: HttpStatus.BAD_REQUEST,
  flags_not_acknowledged: HttpStatus.BAD_REQUEST,
  override_not_allowed: HttpStatus.BAD_REQUEST,
  transactions_not_reviewed: HttpStatus.BAD_REQUEST,
  core_unavailable: HttpStatus.SERVICE_UNAVAILABLE,
};

/** The HTTP answer for a refused domain operation; the body names the failure, never an input. */
export const failureException = (
  failure: DecisionFailure | RerunFailure,
  details: Record<string, unknown> = {},
): HttpException =>
  new HttpException({ message: failure, ...details }, FAILURE_STATUS[failure]);
