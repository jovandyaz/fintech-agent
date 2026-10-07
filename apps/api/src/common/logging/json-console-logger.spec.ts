import { ConsoleLogger, Logger, type LogLevel } from '@nestjs/common';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import { failedQuery, postgresError } from '../../../test/database-errors.js';
import { JsonConsoleLogger } from './json-console-logger.js';

type WriteSpy = MockInstance<typeof process.stdout.write>;

const ALL_LOG_LEVELS: LogLevel[] = [
  'verbose',
  'debug',
  'log',
  'warn',
  'error',
  'fatal',
];
const STACK = 'Error: boom\n    at run (job.ts:1:1)';
const PAN = '4111111111111111';
const PHONE = '+52 55 1234 5678';
const JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjdXNfMDEiLCJqdGkiOiJqMSJ9.c2lnbmF0dXJlc2lnbmF0dXJl';
const EIGHT_DIGITS = /\d{8}/;

function linesWrittenTo(write: WriteSpy): string[] {
  return write.mock.calls.map(([chunk]) => String(chunk));
}

function onlyEntry(write: WriteSpy): Record<string, unknown> {
  const lines = linesWrittenTo(write);
  expect(lines).toHaveLength(1);
  const [line = ''] = lines;
  expect(line.endsWith('\n')).toBe(true);
  expect(line.trimEnd()).not.toContain('\n');
  return JSON.parse(line) as Record<string, unknown>;
}

describe('JsonConsoleLogger behind Nest Logger', () => {
  let stdout: WriteSpy;
  let stderr: WriteSpy;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    Logger.overrideLogger(new JsonConsoleLogger());
    Logger.overrideLogger(ALL_LOG_LEVELS);
  });

  afterEach(() => {
    Logger.overrideLogger(new ConsoleLogger());
    vi.restoreAllMocks();
  });

  it('lifts an event payload to top-level fields with the event as the message', () => {
    new Logger('Webhooks').warn({
      event: 'webhook.rejected',
      reason: 'bad_signature',
      count: 2,
    });

    const entry = onlyEntry(stdout);
    expect(entry).toEqual({
      level: 'warn',
      message: 'webhook.rejected',
      event: 'webhook.rejected',
      reason: 'bad_signature',
      count: 2,
      context: 'Webhooks',
      timestamp: expect.any(String) as unknown,
    });
    expect(Number.isNaN(Date.parse(String(entry.timestamp)))).toBe(false);
  });

  it('prefers a non-empty message field, then the event, the operation and the context', () => {
    const logger = new Logger('Worker');
    logger.warn({ operation: 'claim', message: 'lease lost' });
    logger.warn({ operation: 'claim', message: '' });
    logger.warn({ event: 'probe', operation: 'claim' });
    logger.warn({ reason: 'timeout' });

    expect(
      linesWrittenTo(stdout).map(
        (line) => (JSON.parse(line) as { message: string }).message,
      ),
    ).toEqual(['lease lost', 'claim', 'probe', 'Worker']);
  });

  it('keeps a plain string message as is', () => {
    new Logger('NestApplication').log('Nest application successfully started');

    expect(onlyEntry(stdout)).toEqual({
      level: 'info',
      message: 'Nest application successfully started',
      context: 'NestApplication',
      timestamp: expect.any(String) as unknown,
    });
  });

  it.each([
    ['verbose', 'debug'],
    ['debug', 'debug'],
    ['log', 'info'],
    ['warn', 'warn'],
    ['fatal', 'error'],
  ] as const)(
    'maps the %s level to the %s severity on stdout',
    (method, level) => {
      new Logger('Probe')[method]('probe');

      expect(onlyEntry(stdout).level).toBe(level);
    },
  );

  it('still honours the configured log levels', () => {
    Logger.overrideLogger(['warn', 'error']);

    new Logger('Probe').log('dropped');

    expect(linesWrittenTo(stdout)).toEqual([]);
  });

  it('writes an error to stderr with its stack on the same line', () => {
    new Logger('Jobs').error({ event: 'job.failed', caseId: 'case_a1' }, STACK);

    expect(linesWrittenTo(stdout)).toEqual([]);
    expect(onlyEntry(stderr)).toMatchObject({
      level: 'error',
      message: 'job.failed',
      caseId: 'case_a1',
      context: 'Jobs',
      stack: STACK,
    });
  });

  it('folds warn(text, error) into one line with the error fields and stack', () => {
    const failure = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
      port: 5432,
      address: { host: '127.0.0.1' },
    });

    new Logger('Database').warn('Database connection error', failure);

    const { stack, ...entry } = onlyEntry(stdout);
    expect(entry).toEqual({
      level: 'warn',
      message: 'Database connection error',
      error: {
        name: 'Error',
        message: 'connect ECONNREFUSED',
        code: 'ECONNREFUSED',
        port: 5432,
      },
      context: 'Database',
      timestamp: expect.any(String) as unknown,
    });
    const [head, ownFrame] = String(stack).split('\n');
    expect(head).toBe('Error: connect ECONNREFUSED');
    expect(ownFrame).toContain('json-console-logger.spec.ts:');
  });

  it('takes the message from an error logged on its own', () => {
    new Logger('Probe').warn(new Error('lonely failure'));

    expect(onlyEntry(stdout)).toMatchObject({
      message: 'lonely failure',
      error: { name: 'Error', message: 'lonely failure' },
    });
  });

  it('keeps extra text arguments as details', () => {
    new Logger('Probe').warn('first', 'second', 42);

    expect(onlyEntry(stdout)).toMatchObject({
      message: 'first',
      details: ['second', '42'],
      context: 'Probe',
    });
  });

  it('never lets a payload field override the envelope', () => {
    new Logger('Real').warn({
      event: 'probe',
      level: 'debug',
      timestamp: 0,
      context: 'spoofed',
    });

    expect(onlyEntry(stdout)).toMatchObject({
      level: 'warn',
      context: 'Real',
      timestamp: expect.any(String) as unknown,
    });
  });

  it('describes an Error nested in a payload instead of dropping it', () => {
    new Logger('Probe').warn({
      event: 'probe',
      cause: new Error('nested failure'),
    });

    expect(onlyEntry(stdout).cause).toEqual({
      name: 'Error',
      message: 'nested failure',
    });
  });

  describe('a database error', () => {
    const SECRET_PARAM = 'sentinel-secret-param';
    const DIAGNOSTICS =
      'DrizzleQueryError (failureCategory=unique_violation, sqlState=23505, table=cases, constraint=cases_ticket_id_unique)';

    function rejectedInsert() {
      return failedQuery(
        ['T-1', SECRET_PARAM],
        postgresError({
          message:
            'duplicate key value violates unique constraint "cases_ticket_id_unique"',
          code: '23505',
          table_name: 'cases',
          constraint_name: 'cases_ticket_id_unique',
          detail: `Key (ticket_id)=(${SECRET_PARAM}) already exists.`,
        }),
      );
    }

    it('is described by its diagnostics, never by its parameters', () => {
      new Logger('Cases').error('Failed to create case', rejectedInsert());

      const entry = onlyEntry(stderr);
      expect(JSON.stringify(entry)).not.toContain(SECRET_PARAM);
      expect(entry).toMatchObject({
        message: 'Failed to create case',
        error: { name: 'Error', message: DIAGNOSTICS },
      });
      expect(String(entry.stack).split('\n')[0]).toMatch(
        /^DrizzleQueryError \(failureCategory=unique_violation, sqlState=[\d•]{5}, table=cases/,
      );
    });

    it('is described by its diagnostics when nested in a payload', () => {
      new Logger('Probe').warn({ event: 'probe', cause: rejectedInsert() });

      const entry = onlyEntry(stdout);
      expect(JSON.stringify(entry)).not.toContain(SECRET_PARAM);
      expect(entry.cause).toMatchObject({ message: DIAGNOSTICS });
    });
  });

  describe('personal data and credentials (02 G6)', () => {
    it('masks personal data in the message, the details and every field', () => {
      new Logger('Probe').warn(`card ${PAN}`, `call ${PHONE}`, {
        nested: { note: `paid with ${PAN}` },
        phone: PHONE,
      });

      expect(linesWrittenTo(stdout).join('')).not.toMatch(EIGHT_DIGITS);
    });

    it('masks a message spread over several lines', () => {
      const card = '4532015112830366';
      const failure = new Error(
        `bad card ${card.slice(0, 4)}\n${card.slice(4, 8)}\n${card.slice(8, 12)}\n${card.slice(12)}`,
      );
      failure.stack = `Error: ${failure.message}\n    at run (/app/src/jobs/worker.ts:1234:56)\n    at next (/app/src/jobs/queue.ts:789:10)`;

      new Logger('Probe').error('failed', failure);

      const line = JSON.stringify(onlyEntry(stderr));
      expect(line).not.toContain(card.slice(4, 8));
      expect(line).not.toContain(card.slice(8, 12));
    });

    it.each([
      [
        'a frame-shaped line holding a spaced card',
        '    at 4532 0151 1283 0366',
        '0151',
      ],
      [
        'a real frame with an 8-digit run',
        '    at run (/app/12345678/worker.ts:1:1)',
        '12345678',
      ],
      [
        'a spaced card as a function name',
        '    at 4532 0151 1283 0366 (/x.js:1:1)',
        '0151',
      ],
      [
        'a dotted card as a function name',
        '    at 4532.0151.1283.0366 (/x:1:1)',
        '0151',
      ],
      ['a phone as a function name', '    at 55 1234 5678 (/x:1:1)', '1234'],
      [
        'a dashed card in a path',
        '    at /app/4532-0151-1283-0366/x.js:1:1',
        '0151',
      ],
      [
        'an RFC as a function name',
        '    at GODE561231GR8 (/app/x.js:1:1)',
        'GODE561231GR8',
      ],
      [
        'a CURP as a function name',
        '    at GOMC800101HDFRRR09 (/x:1:1)',
        'GOMC800101HDFRRR09',
      ],
      ['a token as a function name', `    at ${JWT} (/x:1:1)`, JWT],
      [
        'a card spread over several frames',
        ['4532', '0151', '1283', '0366']
          .map((part) => `    at f${part} (/x.js:1:1)`)
          .join('\n'),
        'f0151',
      ],
    ])('masks %s after the message', (_, frame, leaked) => {
      const failure = new Error('boom');
      failure.stack = `Error: boom\n${frame}`;

      new Logger('Probe').error('failed', failure);

      expect(JSON.stringify(onlyEntry(stderr))).not.toContain(leaked);
    });

    it.each([
      [
        'a cause stack appended to the error stack',
        () => {
          const cause = new Error('card\n4532\n0151\n1283\n0366');
          const error = new Error('outer');
          error.stack = `${error.stack ?? ''}\nCaused by: ${cause.stack ?? ''}`;
          return error;
        },
      ],
      [
        'a message shortened after the stack was read',
        () => {
          const error = new Error('card\n4532\n0151\n1283\n0366');
          void error.stack;
          error.message = 'card';
          return error;
        },
      ],
      [
        'a phone in pairs across frame locations',
        () => {
          const error = new Error('boom');
          error.stack =
            'Error: boom\n    at a (/x/55:1:1)\n    at b (/x/0151:1:1)\n    at c (/x/1283:1:1)';
          return error;
        },
      ],
      [
        'number words split across frame names',
        () => {
          const error = new Error('boom');
          error.stack =
            'Error: boom\n    at cuatro cinco tres dos (/x:1:1)\n    at cero uno cinco uno (/x:1:1)';
          return error;
        },
      ],
    ])('masks %s as one message', (_, make) => {
      new Logger('Probe').error('failed', make());

      const stack = String(onlyEntry(stderr).stack);
      expect(stack.replace(/\D/g, '').length).toBeLessThan(8);
    });

    it('masks a function name V8 took from a computed key', () => {
      const handlers = { ['55-1234-5678']: () => new Error('boom') };

      new Logger('Probe').error('failed', handlers['55-1234-5678']());

      expect(JSON.stringify(onlyEntry(stderr))).not.toContain('1234-5678');
    });

    it('masks personal data in a stack passed as text', () => {
      Logger.error(
        'failed',
        `Error: x\n    at 4532 0151 1283 0366 (/x:1:1)`,
        'Probe',
      );

      expect(JSON.stringify(onlyEntry(stderr))).not.toContain('0151');
    });

    it('masks personal data in an error message and its stack', () => {
      new Logger('Probe').error('failed', new Error(`bad card ${PAN}`));

      expect(linesWrittenTo(stderr).join('')).not.toMatch(EIGHT_DIGITS);
    });

    it.each([
      ['authorization', `Bearer ${JWT}`],
      ['Authorization', `Bearer ${JWT}`],
      ['caseToken', JWT],
      ['case_token', JWT],
      ['operatorToken', 'op-token-ana-123'],
      ['operator_token', 'op-token-ana-123'],
      ['token', JWT],
      ['cookie', 'session=abc123def'],
      ['x-api-key', 'sk-ant-api03-secret'],
      ['executorKey', 'dev-core-executor-key'],
      ['signingKey', 'dev-case-token-key-0123456789abcdef'],
      ['privateKey', 'abc'],
      ['bearer', 'op-token-ana-123'],
      ['credentials', 'op-token-ana-123'],
      ['OPERATOR_TOKENS', 'ana:op-token-ana-secret,beto:op-token-beto-secret'],
      ['secrets', 'shh-very-secret'],
      ['cookies', 'session=abcdefghijklmnop'],
      ['authHeader', 'op-token-ana-secret'],
      [
        'jwt',
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefghijklmnopqrstuvwxyzABCDEF',
      ],
    ])('redacts %s whole', (key, value) => {
      new Logger('Probe').warn({ event: 'probe', headers: { [key]: value } });

      const entry = onlyEntry(stdout);
      expect(JSON.stringify(entry)).not.toContain(value);
      expect(entry.headers).toEqual({ [key]: '[redacted]' });
    });

    const BEARER = 'Bearer ana-operator-dev-token-secret';
    it.each([
      [
        'name/value pairs',
        {
          headers: [
            ['authorization', BEARER],
            ['cookie', 'session=abcdefghijklmnop'],
          ],
        },
      ],
      [
        'fetch Headers entries',
        { headers: [...new Headers({ authorization: BEARER })] },
      ],
      [
        'a fetch Headers object',
        { headers: new Headers({ authorization: BEARER }) },
      ],
      [
        'a flat rawHeaders list',
        { rawHeaders: ['host', 'api', 'authorization', BEARER] },
      ],
      [
        'a {name, value} record',
        { header: { name: 'authorization', value: BEARER } },
      ],
      [
        'a bearer credential under a harmless key',
        { note: `retried with ${BEARER}` },
      ],
      [
        'a Token scheme in text',
        { note: 'Authorization: Token ana-operator-dev-token-secret' },
      ],
      [
        'an access_token query parameter',
        { url: 'https://x/cb?access_token=ana-operator-dev-token-secret&x=1' },
      ],
      [
        'a bearer token the masker would split',
        { note: 'Bearer ana-operator-dev-token5512345678yzabcdefghijklmnop' },
      ],
      [
        'a record with a value field of another name',
        { header: { name: 'authorization', val: BEARER } },
      ],
      ['nested operator tokens', { operatorTokens: { ana: BEARER } }],
    ])('redacts an authorization header given as %s', (_, payload) => {
      new Logger('Probe').warn({ event: 'probe', ...payload });

      const line = JSON.stringify(onlyEntry(stdout));
      expect(line).not.toContain('ana-operator-dev-token');
      expect(line).not.toContain('abcdefghijklmnop');
    });

    it.each([
      [
        'an Error stack',
        () => [
          'x',
          new Error('auth failed: Bearer x5512345678yzSECRETPARTxyz'),
        ],
      ],
      [
        'a stack passed as text',
        () => [
          'x',
          'Error: Bearer x5512345678yzSECRETPARTxyz\n    at f (/x.js:1:1)',
        ],
      ],
      [
        'an access_token in an Error stack',
        () => [
          'x',
          new Error('GET /cb?access_token=ab12345678cdSECRETPARTxyz failed'),
        ],
      ],
    ])('redacts a credential in %s before masking it', (_, args) => {
      const [message, stack] = args();
      new Logger('Probe').error(message, stack);

      expect(JSON.stringify(onlyEntry(stderr))).not.toContain('SECRETPART');
    });

    it.each([
      ['an auth key', { auth: 'op-token-ana-SECRETPART' }],
      ['a fragment token', { url: '/cb#access_token=op-SECRETPART' }],
      ['a case_token parameter', { url: '/cb?case_token=op-SECRETPART' }],
      ['a jwt parameter', { url: '/cb?jwt=op-SECRETPART' }],
      ['an auth parameter', { url: '/cb?auth=op-SECRETPART' }],
      ['token= in text', { note: 'token=ana-operator-dev-SECRETPART' }],
      ['token: in text', { note: 'token: ana-operator-dev-SECRETPART' }],
      [
        'a record naming the secret in another field',
        { header: { field: 'password', header: 'hunter-two-SECRETPART' } },
      ],
    ])('redacts %s', (_, payload) => {
      new Logger('Probe').warn({ event: 'probe', ...payload });

      expect(JSON.stringify(onlyEntry(stdout))).not.toContain('SECRETPART');
    });

    it('redacts a credential in the context of a fallback line', () => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();

      new Logger('Bearer op-token-ana-SECRETPART').warn('probe', proxy, {
        get x(): string {
          throw new Error('getter');
        },
      });

      expect(JSON.stringify(onlyEntry(stdout))).not.toContain('SECRETPART');
    });

    it('keeps the envelope and fields of an event whose name looks like a secret', () => {
      new Logger('Worker').warn({
        event: 'case.claimed',
        name: 'tokenRefresh',
        case_id: 'case_a1',
        attempts: 2,
      });

      expect(onlyEntry(stdout)).toMatchObject({
        level: 'warn',
        message: 'case.claimed',
        event: 'case.claimed',
        case_id: 'case_a1',
        attempts: 2,
        context: 'Worker',
      });
    });

    it('keeps the message of an error named like a token failure', () => {
      const expired = Object.assign(
        new Error('"exp" claim timestamp check failed'),
        {
          name: 'JWTExpired',
          code: 'ERR_JWT_EXPIRED',
        },
      );

      new Logger('Mcp').warn('case token rejected', expired);

      expect(onlyEntry(stdout)).toMatchObject({
        message: 'case token rejected',
        error: {
          name: 'JWTExpired',
          code: 'ERR_JWT_EXPIRED',
          message: '"exp" claim timestamp check failed',
        },
      });
    });

    it('keeps an idempotency key, which correlates an execution', () => {
      new Logger('Executor').log({
        event: 'execution.started',
        idempotencyKey: 'act_a1b2',
        note: 'idempotency key=act_a1b2',
      });

      expect(onlyEntry(stdout)).toMatchObject({
        idempotencyKey: 'act_a1b2',
        note: 'idempotency key=act_a1b2',
      });
    });

    it('keeps token counts, which are not credentials', () => {
      new Logger('Probe').log({
        event: 'run.step',
        inputTokens: 1234,
        outputTokens: 56,
      });

      expect(onlyEntry(stdout)).toMatchObject({
        inputTokens: 1234,
        outputTokens: 56,
      });
    });

    it('keeps registry ids and folios readable', () => {
      new Logger('Probe').log({
        event: 'case.queued',
        case_id: 'case_a1b2',
        folio: 'AC-KMQX-PDRT',
      });

      expect(onlyEntry(stdout)).toMatchObject({
        case_id: 'case_a1b2',
        folio: 'AC-KMQX-PDRT',
      });
    });
  });

  it('logs a circular payload instead of throwing into the caller', () => {
    const payload: Record<string, unknown> = { event: 'probe' };
    payload.self = payload;

    expect(() => new Logger('Probe').warn(payload)).not.toThrow();
    expect(onlyEntry(stdout)).toMatchObject({
      level: 'warn',
      message: 'probe',
      self: { event: 'probe', self: '[circular]' },
    });
  });

  it('logs a payload nested far beyond what it prints without throwing', () => {
    const DEPTH_BEYOND_THE_CALL_STACK = 100_000;
    const payload: Record<string, unknown> = { event: 'probe' };
    let innermost = payload;
    for (let level = 0; level < DEPTH_BEYOND_THE_CALL_STACK; level += 1) {
      const next: Record<string, unknown> = {};
      innermost.next = next;
      innermost = next;
    }

    expect(() => new Logger('Probe').warn(payload)).not.toThrow();
    expect(onlyEntry(stdout)).toMatchObject({ message: 'probe' });
  });

  const throwing = (): Error => {
    throw new Error('getter');
  };
  const hostile: [string, () => unknown[]][] = [
    [
      'a payload with a throwing getter',
      () => [
        {
          event: 'probe',
          get x() {
            return throwing();
          },
        },
      ],
    ],
    [
      'a revoked proxy as the message',
      () => {
        const { proxy, revoke } = Proxy.revocable({}, {});
        revoke();
        return ['probe', proxy];
      },
    ],
    [
      'an error with a throwing message',
      () => {
        const error = new Error('m');
        Object.defineProperty(error, 'message', { get: throwing });
        return ['probe', error];
      },
    ],
    [
      'an error with an enumerable throwing getter',
      () => {
        const error = new Error('m');
        Object.defineProperty(error, 'detail', {
          get: throwing,
          enumerable: true,
        });
        return ['probe', error];
      },
    ],
    [
      'an error whose stack is not text',
      () => {
        const error = new Error('m');
        error.stack = 42 as unknown as string;
        return ['probe', error];
      },
    ],
    [
      'an error proxy that refuses its keys',
      () => [
        'probe',
        new Proxy(new Error('m'), {
          ownKeys: () => {
            throw new Error('keys');
          },
        }),
      ],
    ],
  ];

  it.each(hostile)('logs %s instead of throwing into the caller', (_, args) => {
    const [first, ...rest] = args();
    expect(() => new Logger('Probe').warn(first, ...rest)).not.toThrow();
    expect(onlyEntry(stdout)).toMatchObject({
      level: 'warn',
      context: 'Probe',
    });
  });

  it('logs a payload holding a revoked proxy instead of throwing', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(() =>
      new Logger('Probe').warn({ event: 'probe', proxy }),
    ).not.toThrow();
    expect(onlyEntry(stdout)).toMatchObject({ message: 'probe' });
  });
});
