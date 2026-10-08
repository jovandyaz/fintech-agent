import { StatusSchema } from '@fintech-agent/contracts/console';
import { useQuery } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import { useApi } from './api/context.js';
import { saveToken } from './session/token.js';

const ANA = 'dev-operator-ana-token-0123456789';
const BETO = 'dev-operator-beto-token-0123456789';
const OTHER = 'not-an-operator-token-000000000';
const UNAUTHORIZED = 401;
const NOT_FOUND = 404;
// Past three 5 s polls and every retry TanStack Query would schedule.
const SEVERAL_POLLS_MS = 16_000;
const OPERATORS: Record<string, string> = { [ANA]: 'ana', [BETO]: 'beto' };

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

// An api that knows two operator tokens, can turn one away, and can hold one
// answer back until the test releases it.
function fakeApi() {
  const refusing = new Set<string>();
  const held: (() => void)[] = [];
  let holdNext = false;
  const calls: string[] = [];
  const answer = (input: RequestInfo | URL, init?: RequestInit) => {
    const bearer = new Headers(init?.headers).get('authorization') ?? '';
    const token = bearer.replace('Bearer ', '');
    const operator = OPERATORS[token];
    calls.push(urlOf(input));
    if (!operator || refusing.has(token)) {
      return new Response(null, { status: UNAUTHORIZED });
    }
    if (urlOf(input) === '/api/me') return Response.json({ id: operator });
    if (urlOf(input) === '/api/status') return Response.json({ agent: 'on' });
    return new Response(null, { status: NOT_FOUND });
  };
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!holdNext) return Promise.resolve(answer(input, init));
    holdNext = false;
    return new Promise<Response>((resolve) => {
      held.push(() => resolve(answer(input, init)));
    });
  };
  return {
    fetch,
    calls,
    refuse: (token: string) => refusing.add(token),
    holdNextAnswer: () => {
      holdNext = true;
    },
    releaseHeld: () => held.splice(0).forEach((release) => release()),
  };
}

function Draft() {
  const api = useApi();
  return (
    <div>
      <label>
        Borrador
        <textarea defaultValue="" />
      </label>
      <button
        type="button"
        onClick={() => {
          api.get('/status', StatusSchema).catch(() => undefined);
        }}
      >
        Consultar
      </button>
    </div>
  );
}

function PolledStatus() {
  const api = useApi();
  const status = useQuery({
    queryKey: ['status'],
    queryFn: () => api.get('/status', StatusSchema),
  });
  return <p>{status.isError ? 'sin estado' : status.data?.agent}</p>;
}

const draftField = () => screen.getByLabelText<HTMLTextAreaElement>('Borrador');
const signedInWork = () =>
  screen.queryByRole('button', { name: 'Cerrar sesión' });

const signIn = (token: string) => {
  fireEvent.change(screen.getByLabelText('Token de operador'), {
    target: { value: token },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
};

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe('console session (02 G3: the operator is authenticated, never declared)', () => {
  it('asks for the operator token before showing any work', () => {
    render(<App fetch={fakeApi().fetch} />);
    expect(screen.getByLabelText('Token de operador')).toBeTruthy();
    expect(signedInWork()).toBeNull();
  });

  it('signs in with a token the api recognizes and names the operator', async () => {
    render(<App fetch={fakeApi().fetch} />);
    signIn(ANA);
    expect(await screen.findByText('ana')).toBeTruthy();
    expect(screen.getByText('Operador')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('refuses a token the api does not recognize, says so, and marks the field', async () => {
    render(<App fetch={fakeApi().fetch} />);
    signIn(OTHER);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Ese token no corresponde a ningún operador.',
    );
    const field = screen.getByLabelText('Token de operador');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe(alert.id);
    expect(signedInWork()).toBeNull();
  });

  it('asks to sign in again over the open work when the session ends, keeping the draft', async () => {
    const api = fakeApi();
    saveToken(ANA);
    render(
      <App fetch={api.fetch}>
        <Draft />
      </App>,
    );
    const draft = await screen.findByLabelText('Borrador');
    fireEvent.change(draft, { target: { value: 'Hola, revisamos tu caso.' } });
    draft.focus();
    api.refuse(ANA);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(draftField().value).toBe('Hola, revisamos tu caso.');
    expect(draftField().closest('[inert]')).not.toBeNull();

    signIn(BETO);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(draftField().value).toBe('Hola, revisamos tu caso.');
    expect(draftField().closest('[inert]')).toBeNull();
    expect(document.activeElement).toBe(draftField());
    expect(await screen.findByText('beto')).toBeTruthy();
  });

  it('ignores a late refusal of the old token once signed in again, and calls with the new one', async () => {
    const api = fakeApi();
    saveToken(ANA);
    render(
      <App fetch={api.fetch}>
        <Draft />
      </App>,
    );
    await screen.findByLabelText('Borrador');
    api.refuse(ANA);
    api.holdNextAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));
    await screen.findByRole('dialog');
    signIn(BETO);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await act(async () => {
      api.releaseHeld();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('neither retries nor polls a request refused for its token while the session is ended', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = fakeApi();
      saveToken(ANA);
      api.refuse(ANA);
      render(
        <App fetch={api.fetch}>
          <PolledStatus />
        </App>,
      );
      await screen.findByRole('dialog');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SEVERAL_POLLS_MS);
      });
      expect(api.calls.filter((url) => url === '/api/status')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('signs out and forgets the token', async () => {
    saveToken(ANA);
    render(<App fetch={fakeApi().fetch} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Cerrar sesión' }),
    );
    expect(screen.getByLabelText('Token de operador')).toBeTruthy();
    expect(sessionStorage.length).toBe(0);
  });
});
