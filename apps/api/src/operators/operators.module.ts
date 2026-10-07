import { Module, type DynamicModule } from '@nestjs/common';

import { OPERATOR_CREDENTIALS, OperatorGuard } from './operator.guard.js';
import { parseOperatorTokens } from './operator-tokens.js';

/** Operator identity for every console route (02 G3); global, so any controller can use `OperatorGuard`. */
@Module({})
export class OperatorsModule {
  static register(operatorTokens: string): DynamicModule {
    return {
      module: OperatorsModule,
      global: true,
      providers: [
        OperatorGuard,
        {
          provide: OPERATOR_CREDENTIALS,
          useValue: parseOperatorTokens(operatorTokens),
        },
      ],
      exports: [OperatorGuard, OPERATOR_CREDENTIALS],
    };
  }
}
