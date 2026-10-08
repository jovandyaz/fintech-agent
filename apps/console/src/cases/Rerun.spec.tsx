import type { CaseDetail } from '@fintech-agent/contracts/console';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { detail } from '../test/case-detail.js';
import { heldAnswer, renderWithApi, type Routes } from '../test/harness.js';
import { CaseView } from './CaseView.js';

const CONFLICT = 409;
const SERVER_ERROR = 500;
const RERUN = 'POST /cases/case_abc/rerun';
const AGAIN = 'Volver a investigar';

const withCase = (
  over: Partial<CaseDetail['case']>,
  rest: Partial<CaseDetail> = {},
) => {
  const data = detail(rest);
  return { ...data, case: { ...data.case, ...over } };
};

const openCase = (data: CaseDetail, routes: Routes = {}) =>
  renderWithApi(<CaseView caseId="case_abc" onClose={vi.fn()} />, {
    'GET /cases/case_abc': Response.json(data),
    ...routes,
  });

const queued = Response.json({
  case_id: 'case_abc',
  status: 'queued',
  manual_reruns: 1,
});

afterEach(cleanup);

describe('run again (02 G3 re-runs, at most 3)', () => {
  it('sends the case back to the agent and reloads it', async () => {
    const { seen } = openCase(withCase({}), { [RERUN]: queued });
    fireEvent.click(await screen.findByRole('button', { name: AGAIN }));
    await vi.waitFor(() =>
      expect(seen.filter(({ url }) => url === '/cases/case_abc')).toHaveLength(
        2,
      ),
    );
    expect(
      seen.some(
        ({ method, url }) =>
          method === 'POST' && url === '/cases/case_abc/rerun',
      ),
    ).toBe(true);
  });

  it('moves focus to the case heading once the case is back with the agent', async () => {
    const reads = [
      withCase({}),
      withCase({ status: 'queued' }, { proposal: null }),
    ];
    const after = reads[1]!;
    renderWithApi(<CaseView caseId="case_abc" onClose={vi.fn()} />, {
      'GET /cases/case_abc': () => Response.json(reads.shift() ?? after),
      [RERUN]: queued,
    });
    const again = await screen.findByRole('button', { name: AGAIN });
    again.focus();
    fireEvent.click(again);
    await vi.waitFor(() =>
      expect(screen.queryByRole('button', { name: AGAIN })).toBeNull(),
    );
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Caso AC-K55M-76NH' }),
    );
  });

  it('says how many runs are left and that the open proposal is replaced', async () => {
    openCase(withCase({ manual_reruns: 1 }));
    await screen.findByRole('button', { name: AGAIN });
    expect(
      screen.getByText('Quedan 2 de 3. La propuesta abierta se descarta.'),
    ).toBeTruthy();
  });

  it('offers it on a failed case too, without a proposal to replace', async () => {
    openCase(
      withCase({ status: 'failed' }, { proposal: null, resolution: null }),
    );
    await screen.findByRole('button', { name: AGAIN });
    expect(screen.getByText('Quedan 3 de 3.')).toBeTruthy();
  });

  it('is gone once the three runs are spent', async () => {
    openCase(withCase({ manual_reruns: 3 }));
    expect(
      await screen.findByText('Este caso ya usó sus 3 nuevas investigaciones.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: AGAIN })).toBeNull();
  });

  it('is not offered while the agent is still on the case', async () => {
    openCase(withCase({ status: 'investigating' }, { proposal: null }));
    await screen.findByRole('heading', { name: 'Caso AC-K55M-76NH' });
    expect(screen.queryByRole('button', { name: AGAIN })).toBeNull();
  });

  it('says when the case can no longer be run again', async () => {
    openCase(withCase({}), {
      [RERUN]: Response.json({ message: 'conflict' }, { status: CONFLICT }),
    });
    fireEvent.click(await screen.findByRole('button', { name: AGAIN }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'No se pudo volver a investigar: el caso ya no lo admite o cambió de estado.',
    );
  });

  it('reloads the case when it can no longer be run again', async () => {
    const { seen } = openCase(withCase({}), {
      [RERUN]: Response.json({ message: 'conflict' }, { status: CONFLICT }),
    });
    fireEvent.click(await screen.findByRole('button', { name: AGAIN }));
    await vi.waitFor(() =>
      expect(seen.filter(({ url }) => url === '/cases/case_abc')).toHaveLength(
        2,
      ),
    );
  });

  it('says when the api could not take the request', async () => {
    openCase(withCase({}), {
      [RERUN]: Response.json(
        { message: 'internal_error' },
        { status: SERVER_ERROR },
      ),
    });
    fireEvent.click(await screen.findByRole('button', { name: AGAIN }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'No pudimos volver a investigar el caso. Intenta de nuevo en unos segundos.',
    );
  });

  it('runs once however many times the operator clicks while it is sent', async () => {
    const held = heldAnswer(queued);
    const { seen } = openCase(withCase({}), { [RERUN]: held.answer });
    const again = await screen.findByRole('button', { name: AGAIN });
    fireEvent.click(again);
    fireEvent.click(again);
    held.release();
    await vi.waitFor(() =>
      expect(seen.filter(({ url }) => url === '/cases/case_abc')).toHaveLength(
        2,
      ),
    );
    expect(seen.filter(({ method }) => method === 'POST')).toHaveLength(1);
  });
});
