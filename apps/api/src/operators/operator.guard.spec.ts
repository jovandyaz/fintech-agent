import {
  Controller,
  Get,
  type INestApplication,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CurrentOperator,
  OPERATOR_CREDENTIALS,
  OperatorGuard,
} from './operator.guard.js';
import { parseOperatorTokens, type Operator } from './operator-tokens.js';

const ANA = 'dev-operator-ana-token-0123456789';
const UNAUTHORIZED = 401;

@Controller('unguarded')
class UnguardedController {
  @Get()
  who(@CurrentOperator() operator: Operator): Operator {
    return operator;
  }
}

@Controller('probe')
@UseGuards(OperatorGuard)
class ProbeController {
  @Get()
  who(@CurrentOperator() operator: Operator): Operator {
    return operator;
  }
}

let app: INestApplication;
let base: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProbeController, UnguardedController],
    providers: [
      OperatorGuard,
      {
        provide: OPERATOR_CREDENTIALS,
        useValue: parseOperatorTokens(`ana:k1:${ANA}`),
      },
    ],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});

afterAll(async () => {
  await app?.close();
});

const call = (authorization?: string): Promise<Response> =>
  fetch(`${base}/probe`, {
    headers: authorization === undefined ? {} : { authorization },
  });

describe('OperatorGuard (02 G3 operator identity)', () => {
  it.each([
    ['no header', undefined],
    ['a Basic header', `Basic ${ANA}`],
    ['an unknown token', 'Bearer dev-operator-eve-token-0123456789'],
    ['two spaces before the token', `Bearer  ${ANA}`],
  ])('answers 401 with a Bearer challenge for %s', async (_, header) => {
    const response = await call(header);
    expect(response.status).toBe(UNAUTHORIZED);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(await response.text()).not.toContain(ANA);
  });

  it.each([`Bearer ${ANA}`, `bearer ${ANA}`])(
    'resolves the operator from %s',
    async (header) => {
      const response = await call(header);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: 'ana',
        keyId: 'k1',
        actor: 'operator:ana',
      });
    },
  );

  it('refuses a route that reads the operator without the guard', async () => {
    const response = await fetch(`${base}/unguarded`);
    expect(response.status).toBe(UNAUTHORIZED);
  });
});
