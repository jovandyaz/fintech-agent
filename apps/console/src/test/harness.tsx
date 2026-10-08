import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createApiClient } from '../api/client.js';
import { ApiContext } from '../api/context.js';

const NOT_FOUND = 404;

/** One request the fake api saw. */
export interface SeenRequest {
  method: string;
  url: string;
  body: unknown;
}

/** An answer by `METHOD /path?query`, or a function of the request body that may answer later. */
export type Routes = Record<
  string,
  Response | ((body: unknown) => Response | Promise<Response>)
>;

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

/**
 * Renders `ui` signed in, against an api that answers `routes` by
 * `"METHOD /path"` (path as the client sends it, without /api) and records
 * every request; anything else is a 404.
 */
export function renderWithApi(
  ui: ReactNode,
  routes: Routes,
): RenderResult & { seen: SeenRequest[] } {
  const seen: SeenRequest[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const url = urlOf(input).replace(/^\/api/, '');
    const body: unknown =
      typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    seen.push({ method, url, body });
    const route = routes[`${method} ${url}`];
    if (route === undefined) {
      return Promise.resolve(new Response(null, { status: NOT_FOUND }));
    }
    const answer = typeof route === 'function' ? route(body) : route;
    return Promise.resolve(answer).then((response) => response.clone());
  };
  const api = createApiClient({
    fetch,
    token: () => 'test-operator-token',
    onUnauthorized: () => undefined,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  const result = render(
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </ApiContext.Provider>,
  );
  return Object.assign(result, { seen });
}

/** An answer the test releases when it chooses, to observe the waiting state. */
export function heldAnswer(response: Response) {
  let release = (): void => undefined;
  const answer = new Promise<Response>((resolve) => {
    release = () => resolve(response);
  });
  return { answer: () => answer, release: () => release() };
}
