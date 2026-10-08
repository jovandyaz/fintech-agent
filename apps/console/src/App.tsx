import {
  OperatorViewSchema,
  type OperatorView,
} from '@fintech-agent/contracts/console';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { UnauthorizedError, createApiClient } from './api/client.js';
import { ApiContext, useApi } from './api/context.js';
import { SignIn } from './session/SignIn.js';
import { clearToken, readToken, saveToken } from './session/token.js';

// The console polls rather than streams (01 §Components); a case moves on the
// worker's clock, so a few seconds of staleness is the trade.
const POLL_MS = 5_000;
const MAX_RETRIES = 2;
const ME = ['me'] as const;

const browserFetch: typeof fetch = (input, init) =>
  globalThis.fetch(input, init);

function Shell(props: { onSignOut: () => void; children: ReactNode }) {
  const api = useApi();
  const me = useQuery({
    queryKey: ME,
    queryFn: () => api.get('/me', OperatorViewSchema),
    refetchInterval: false,
  });
  return (
    <div className="shell">
      <header className="shell-header">
        <p className="shell-brand">Case Copilot</p>
        <p className="shell-operator">
          <span className="shell-operator-label">Operador</span>
          <span>{me.data?.id}</span>
        </p>
        <button
          type="button"
          className="button-quiet"
          onClick={props.onSignOut}
        >
          Cerrar sesión
        </button>
      </header>
      <main className="shell-main">{props.children}</main>
    </div>
  );
}

function Workspace() {
  return (
    <section className="workspace-empty">
      <h1>Bandeja</h1>
      <p>Elige un caso para revisarlo.</p>
    </section>
  );
}

/**
 * The ops console: nothing until an operator signs in with a token the api
 * recognizes. When the session ends mid-work, the sign-in opens over the
 * work, which stays mounted but inert, so a reply being edited is neither
 * lost nor reachable until the operator is back, and focus returns to it.
 */
export function App(props: { fetch?: typeof fetch; children?: ReactNode }) {
  const fetchApi = props.fetch ?? browserFetch;
  const [token, setToken] = useState(readToken);
  const [expired, setExpired] = useState(false);
  const tokenRef = useRef(token);
  const expiredRef = useRef(expired);
  const resumeFocus = useRef<HTMLElement | null>(null);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchInterval: () => (expiredRef.current ? false : POLL_MS),
            retry: (failures, error) =>
              !(error instanceof UnauthorizedError) && failures < MAX_RETRIES,
          },
        },
      }),
  );
  const api = useMemo(
    () =>
      createApiClient({
        fetch: fetchApi,
        token: () => tokenRef.current,
        // A poll sent with the old token can answer after a re-sign-in; only
        // a refusal of the token in use ends the session.
        onUnauthorized: (usedToken) => {
          if (usedToken !== tokenRef.current || expiredRef.current) return;
          expiredRef.current = true;
          resumeFocus.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
          setExpired(true);
        },
      }),
    [fetchApi],
  );

  useEffect(() => {
    if (expired || !resumeFocus.current) return;
    resumeFocus.current.focus();
    resumeFocus.current = null;
  }, [expired]);

  const signedIn = (next: string, operator: OperatorView) => {
    saveToken(next);
    tokenRef.current = next;
    expiredRef.current = false;
    setToken(next);
    setExpired(false);
    queryClient.setQueryData(ME, operator);
    void queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] !== ME[0],
    });
  };
  const signOut = () => {
    clearToken();
    tokenRef.current = null;
    expiredRef.current = false;
    resumeFocus.current = null;
    setToken(null);
    setExpired(false);
    queryClient.clear();
  };

  if (token === null) {
    return <SignIn fetch={fetchApi} placement="page" onSignedIn={signedIn} />;
  }
  return (
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={queryClient}>
        <div className="work" inert={expired}>
          <Shell onSignOut={signOut}>{props.children ?? <Workspace />}</Shell>
        </div>
        {expired && (
          <SignIn
            fetch={fetchApi}
            placement="over-work"
            onSignedIn={signedIn}
          />
        )}
      </QueryClientProvider>
    </ApiContext.Provider>
  );
}
