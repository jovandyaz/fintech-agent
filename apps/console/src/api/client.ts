const API_PREFIX = '/api';
const UNAUTHORIZED = 401;
const NO_REASON = 'unexpected_answer';

/** A contracts schema, by the one method the client uses. */
export interface Parser<T> {
  parse: (value: unknown) => T;
}

/** The session ended or the token is unknown; the console asks to sign in again. */
export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'UnauthorizedError';
  }
}

/** A refusal or failure the api answered, by its status and named reason. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(reason);
    this.name = 'ApiError';
  }
}

/** The console's only way to the api. */
export interface ApiClient {
  get: <T>(path: string, schema: Parser<T>) => Promise<T>;
  post: <T>(path: string, body: unknown, schema: Parser<T>) => Promise<T>;
}

async function reasonOf(response: Response): Promise<string> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return NO_REASON;
  }
  if (typeof body === 'object' && body !== null && 'message' in body) {
    return typeof body.message === 'string' ? body.message : NO_REASON;
  }
  return NO_REASON;
}

/**
 * Calls the api through the console's own origin (`/api`, proxied), with the
 * operator's bearer token. A 401 tells the session to ask for the token again
 * and fails the call; an answer outside its contract is a failure too.
 */
export function createApiClient(deps: {
  fetch: typeof fetch;
  token: () => string | null;
  /** Told which token the api refused, so a late answer for an old one can be ignored. */
  onUnauthorized: (usedToken: string | null) => void;
}): ApiClient {
  async function call<T>(
    path: string,
    schema: Parser<T>,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    const token = deps.token();
    if (token !== null) headers.set('authorization', `Bearer ${token}`);
    const response = await deps.fetch(`${API_PREFIX}${path}`, {
      ...init,
      headers,
    });
    if (response.status === UNAUTHORIZED) {
      deps.onUnauthorized(token);
      throw new UnauthorizedError();
    }
    if (!response.ok) {
      throw new ApiError(response.status, await reasonOf(response));
    }
    let body: unknown;
    try {
      body = await response.json();
      return schema.parse(body);
    } catch {
      throw new ApiError(response.status, NO_REASON);
    }
  }

  return {
    get: (path, schema) => call(path, schema),
    post: (path, body, schema) =>
      call(path, schema, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}
