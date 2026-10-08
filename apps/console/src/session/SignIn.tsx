import {
  OperatorViewSchema,
  type OperatorView,
} from '@fintech-agent/contracts/console';
import { useId, useState, type FormEvent } from 'react';

import { UnauthorizedError, createApiClient } from '../api/client.js';

const UNKNOWN_TOKEN = 'Ese token no corresponde a ningún operador.';
const NOT_CHECKED = 'No pudimos verificar el token. Intenta de nuevo.';

/** Where the form shows: the whole page before sign-in, or over the open work when a session ends. */
export type SignInPlacement = 'page' | 'over-work';

/**
 * Asks for the operator's token and checks it against `GET /me` before
 * keeping it (02 G3: the operator is authenticated, never declared).
 */
export function SignIn(props: {
  fetch: typeof fetch;
  placement: SignInPlacement;
  onSignedIn: (token: string, operator: OperatorView) => void;
}) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const titleId = useId();
  const inputId = useId();
  const errorId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const candidate = token.trim();
    setChecking(true);
    setError(null);
    const api = createApiClient({
      fetch: props.fetch,
      token: () => candidate,
      onUnauthorized: () => undefined,
    });
    try {
      props.onSignedIn(candidate, await api.get('/me', OperatorViewSchema));
    } catch (failure) {
      setError(
        failure instanceof UnauthorizedError ? UNKNOWN_TOKEN : NOT_CHECKED,
      );
    } finally {
      setChecking(false);
    }
  }

  const form = (
    <form className="sign-in-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor={inputId}>Token de operador</label>
      <input
        id={inputId}
        type="password"
        autoComplete="off"
        spellCheck={false}
        autoFocus
        value={token}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errorId}
        onChange={(event) => setToken(event.target.value)}
      />
      {error && (
        <p id={errorId} className="sign-in-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="button-primary"
        disabled={checking || token.trim() === ''}
      >
        Entrar
      </button>
    </form>
  );

  if (props.placement === 'page') {
    return (
      <main className="sign-in-page">
        <div className="sign-in-card">
          <p className="sign-in-brand">Case Copilot</p>
          <h1 id={titleId}>Revisión de casos</h1>
          {form}
        </div>
      </main>
    );
  }
  return (
    <div className="sign-in-backdrop">
      <div
        className="sign-in-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId}>Tu sesión terminó</h2>
        <p>
          Vuelve a entrar con tu token. Lo que estabas escribiendo sigue aquí.
        </p>
        {form}
      </div>
    </div>
  );
}
