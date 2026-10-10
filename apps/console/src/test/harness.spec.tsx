import { cleanup, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useApi } from '../api/context.js';
import { renderWithApi } from './harness.js';

const passthrough = { parse: (value: unknown) => value };

function Probe({ path }: { path: string }) {
  const api = useApi();
  const [outcome, setOutcome] = useState('pending');
  useEffect(() => {
    api.get(path, passthrough).then(
      () => setOutcome('answered'),
      (error: unknown) =>
        setOutcome(error instanceof Error ? error.message : 'unknown'),
    );
  }, [api, path]);
  return <p>{outcome}</p>;
}

const usedResponse = async () => {
  const response = Response.json([{ id: 'cus_01' }]);
  await response.json();
  return response;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('renderWithApi routes', () => {
  it('answers a fresh Response', async () => {
    renderWithApi(<Probe path="/customers" />, {
      'GET /customers': Response.json([]),
    });
    expect(await screen.findByText('answered')).toBeTruthy();
  });

  it('refuses a Response that was already used, naming the route', async () => {
    const logged = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    renderWithApi(<Probe path="/customers" />, {
      'GET /customers': await usedResponse(),
    });
    expect(
      await screen.findByText(/GET \/customers.*already used/),
    ).toBeTruthy();
    expect(logged).toHaveBeenCalledWith(
      expect.stringMatching(/GET \/customers.*already used/),
    );
  });

  it('refuses a used Response returned by a route function too', async () => {
    const logged = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const used = await usedResponse();
    renderWithApi(<Probe path="/customers" />, {
      'GET /customers': () => used,
    });
    expect(
      await screen.findByText(/GET \/customers.*already used/),
    ).toBeTruthy();
    expect(logged).toHaveBeenCalledWith(
      expect.stringMatching(/GET \/customers.*already used/),
    );
  });
});
