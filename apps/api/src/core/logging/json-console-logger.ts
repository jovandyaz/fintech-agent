import { maskJson, maskPii } from '@fintech-agent/contracts';
import { ConsoleLogger, type LogLevel } from '@nestjs/common';

import { isDatabaseError } from '../errors/database-diagnostics.js';
import { reasonOf } from '../errors/reason-of.js';
import { stackOf } from '../errors/stack-of.js';

const SEVERITY = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const;

type Severity = (typeof SEVERITY)[keyof typeof SEVERITY];

const SEVERITY_BY_LEVEL: Record<LogLevel, Severity> = {
  verbose: SEVERITY.DEBUG,
  debug: SEVERITY.DEBUG,
  log: SEVERITY.INFO,
  warn: SEVERITY.WARN,
  error: SEVERITY.ERROR,
  fatal: SEVERITY.ERROR,
};

const DEFAULT_LOG_LEVEL: LogLevel = 'log';
const MESSAGE_FIELDS = ['message', 'event', 'operation'] as const;
const MAX_DEPTH = 64;
const MARKER = {
  redacted: '[redacted]',
  circular: '[circular]',
  tooDeep: '[too deep]',
  unreadable: '[unreadable]',
} as const;
const SECRET_KEY_PARTS = [
  'authorization',
  'authheader',
  'bearer',
  'cookie',
  'credential',
  'password',
  'passwd',
  'secret',
  'token',
  'jwt',
  'apikey',
];
const SECRET_KEY_ENDINGS = [
  'apikey',
  'privatekey',
  'signingkey',
  'secretkey',
  'executorkey',
  'readkey',
  'tokenkey',
  'accesskey',
  'sessionkey',
];
const SECRET_KEY_NAMES = new Set(['auth']);
const PAIR_NAME_FIELDS = ['name', 'key', 'field', 'header'] as const;
const PAIR_RECORD_KEYS = new Set<string>([
  ...PAIR_NAME_FIELDS,
  'type',
  'kind',
  'value',
  'val',
  'values',
  'data',
]);
const MIN_SCHEME_CREDENTIAL_CHARS = 8;
const SCHEME_CREDENTIAL = new RegExp(
  String.raw`\b(Bearer|Basic)\s+[^\s"',;]{${MIN_SCHEME_CREDENTIAL_CHARS},}`,
  'gi',
);
// "Token" is also an English word, so only a credential-shaped value counts.
const TOKEN_SCHEME_CREDENTIAL =
  /\b(Token)\s+(?=[^\s"',;]*[\d._-])[A-Za-z0-9._~+/=-]{12,}/g;
const CREDENTIAL_ASSIGNMENT =
  /\b([a-z_]*(?:token|password|passwd|secret|jwt|api_?key)|auth)(\s*[:=]\s*)[^\s&#,;"']+/gi;
const UNLOGGABLE = '[unloggable log call]';

type WriteStream = 'stdout' | 'stderr';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isScalar(value: unknown): boolean {
  return (
    value === null || (typeof value !== 'object' && typeof value !== 'function')
  );
}

function firstNonEmptyText(candidates: unknown[]): string | undefined {
  return candidates.find(
    (value): value is string => typeof value === 'string' && value !== '',
  );
}

function errorFields(error: Error): Record<string, unknown> {
  if (isDatabaseError(error)) {
    return { name: error.name, message: reasonOf(error) };
  }
  const scalarProperties = Object.entries(error).filter(([, value]) =>
    isScalar(value),
  );
  return {
    ...Object.fromEntries(scalarProperties),
    name: error.name,
    message: error.message,
  };
}

function isSecretKey(key: unknown): boolean {
  if (typeof key !== 'string') return false;
  const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
  return (
    SECRET_KEY_NAMES.has(normalized) ||
    SECRET_KEY_PARTS.some((part) => normalized.includes(part)) ||
    SECRET_KEY_ENDINGS.some(
      (ending) =>
        normalized.endsWith(ending) || normalized.endsWith(`${ending}s`),
    )
  );
}

// A count such as `inputTokens` matches a secret key name but holds no secret.
const isCredentialValue = (value: unknown): boolean =>
  typeof value !== 'number' && typeof value !== 'boolean';

// maskJson reads own enumerable fields only, so an Error, Date, Map, Set or
// fetch Headers would print as `{}`; they become plain data first.
function toPlainData(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= MAX_DEPTH) return MARKER.tooDeep;
  if (seen.has(value)) return MARKER.circular;
  seen.add(value);
  try {
    if (value instanceof Error) return errorFields(value);
    if (value instanceof Date) return value.toISOString();
    const entries: [string, unknown][] =
      value instanceof Map || value instanceof Headers
        ? [...value.entries()].map(([key, item]) => [String(key), item])
        : Object.entries(value instanceof Set ? [...value] : value);
    const plain = entries.map(
      ([key, item]) => [key, toPlainData(item, depth + 1, seen)] as const,
    );
    return Array.isArray(value) || value instanceof Set
      ? plain.map(([, item]) => item)
      : Object.fromEntries(plain);
  } catch {
    return MARKER.unreadable;
  } finally {
    seen.delete(value);
  }
}

const redactText = (text: string): string =>
  text
    .replace(SCHEME_CREDENTIAL, `$1 ${MARKER.redacted}`)
    .replace(TOKEN_SCHEME_CREDENTIAL, `$1 ${MARKER.redacted}`)
    .replace(CREDENTIAL_ASSIGNMENT, `$1$2${MARKER.redacted}`);

// Runs before maskJson, which could split a token apart, and again after it,
// which labels a keyed token `[factor]` and keeps the tail of a long opaque
// value; credentials are dropped whole, whether keyed, paired
// (`['authorization', …]`, rawHeaders, `{name: 'authorization', …}`) or in text.
function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      index > 0 && isSecretKey(value[index - 1])
        ? MARKER.redacted
        : redactSecrets(item),
    );
  }
  if (!isPlainObject(value)) return value;
  // Only a bare name/value record is a pair; an event or an error that merely
  // has a `name` field keeps its other fields.
  const isPairRecord = Object.keys(value).every((key) =>
    PAIR_RECORD_KEYS.has(key),
  );
  const naming = isPairRecord
    ? PAIR_NAME_FIELDS.find((field) => isSecretKey(value[field]))
    : undefined;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const pairValue = naming !== undefined && key !== naming;
      const secret = (isSecretKey(key) && isCredentialValue(item)) || pairValue;
      return [key, secret ? MARKER.redacted : redactSecrets(item)];
    }),
  );
}

// The whole stack is one message to the masker: its digit budget then spans
// every frame, a "Caused by" tail and any text a message left behind, at the
// cost of line numbers in logs. Credentials go first so masking cannot split them.
const maskStackText = (stack: string): string => maskPii(redactText(stack));

/**
 * Writes each log call as one JSON line: a non-empty string `message`, a
 * `level` of debug/info/warn/error, and the fields of object payloads at the
 * top level. Every value passes `maskJson` and credentials are redacted whole
 * (02 G6 logger sink). A database error is told by its diagnostics, never by a
 * message that can quote query values. `level`, `message`, `timestamp` and
 * `context` always come from the call, and no payload turns the call into a throw.
 */
export class JsonConsoleLogger extends ConsoleLogger {
  constructor() {
    super({ json: true });
  }

  protected override printMessages(
    messages: unknown[],
    context = '',
    logLevel: LogLevel = DEFAULT_LOG_LEVEL,
    writeStreamType?: WriteStream,
    errorStack?: unknown,
  ): void {
    let line: string;
    try {
      line = this.render(messages, context, logLevel, errorStack);
    } catch {
      // A log call runs inside catch blocks; throwing here would hide the
      // error being reported, so a hostile payload yields a bare line instead.
      line = JSON.stringify({
        level: SEVERITY_BY_LEVEL[logLevel],
        message: UNLOGGABLE,
        timestamp: new Date().toISOString(),
        context: redactText(maskPii(redactText(context))) || undefined,
      });
    }
    process[writeStreamType ?? 'stdout'].write(`${line}\n`);
  }

  private render(
    messages: unknown[],
    context: string,
    logLevel: LogLevel,
    errorStack: unknown,
  ): string {
    const fields: Record<string, unknown> = {};
    const texts: string[] = [];
    let error: Error | undefined;
    for (const message of messages) {
      if (isPlainObject(message)) {
        Object.assign(fields, message);
      } else if (message instanceof Error) {
        if (!error) {
          error = message;
          fields.error = errorFields(message);
        }
      } else if (message !== undefined) {
        texts.push(reasonOf(message));
      }
    }
    const [lead, ...details] = texts;
    const envelope = {
      level: SEVERITY_BY_LEVEL[logLevel],
      message:
        firstNonEmptyText([
          lead,
          ...MESSAGE_FIELDS.map((field) => fields[field]),
          error && reasonOf(error),
          context,
        ]) ?? logLevel,
      timestamp: new Date().toISOString(),
      context: context || undefined,
    };
    const stack =
      errorStack !== undefined
        ? maskStackText(
            typeof errorStack === 'string' ? errorStack : reasonOf(errorStack),
          )
        : error && maskStackText(stackOf(error));
    const extras = details.length > 0 ? { details } : {};
    const entry = toPlainData(
      { ...fields, ...extras, ...envelope },
      0,
      new WeakSet(),
    );
    const masked = redactSecrets(maskJson(redactSecrets(entry))) as Record<
      string,
      unknown
    >;
    return JSON.stringify(
      stack === undefined ? masked : { ...masked, stack: redactSecrets(stack) },
    );
  }
}
