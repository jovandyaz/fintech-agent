import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  type Operator,
  type OperatorCredential,
  resolveOperator,
} from './operator-tokens.js';

export const OPERATOR_CREDENTIALS = 'OPERATOR_CREDENTIALS';

const BEARER = /^Bearer (\S+)$/i;
const CHALLENGE = 'Bearer';

type OperatorRequest = Request & { operator?: Operator };

/** Resolves the operator from `Authorization: Bearer`; anything else is 401 (02 G3). */
@Injectable()
export class OperatorGuard implements CanActivate {
  constructor(
    @Inject(OPERATOR_CREDENTIALS)
    private readonly credentials: readonly OperatorCredential[],
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<OperatorRequest>();
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    const operator = token ? resolveOperator(this.credentials, token) : null;
    if (!operator) {
      http.getResponse<Response>().setHeader('WWW-Authenticate', CHALLENGE);
      throw new UnauthorizedException();
    }
    request.operator = operator;
    return true;
  }
}

/** The operator `OperatorGuard` resolved for this request; 401 on a route without the guard. */
export const CurrentOperator = createParamDecorator(
  (_: unknown, context: ExecutionContext): Operator => {
    const { operator } = context.switchToHttp().getRequest<OperatorRequest>();
    if (!operator) throw new UnauthorizedException();
    return operator;
  },
);
