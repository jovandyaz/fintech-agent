import { createContext, useContext } from 'react';

import type { ApiClient } from './client.js';

/** The signed-in console's api client; absent before sign-in. */
export const ApiContext = createContext<ApiClient | null>(null);

/** The api client of the signed-in operator; only inside the signed-in console. */
export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi is only available once signed in');
  return api;
}
