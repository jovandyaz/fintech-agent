import type { CaseDetail, InboxItem } from '@fintech-agent/contracts/console';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithApi } from '../test/harness.js';
import { Workspace } from './Workspace.js';

const ACCEPTED = 202;

const ITEM: InboxItem = {
  case_id: 'case_abc',
  folio: 'AC-K55M-76NH',
  status: 'needs_review',
  review_tier: 'standard',
  flags: [],
  category: 'unrecognized_card_charge',
  received_at: '2026-10-07T21:00:00.000Z',
};

const detailOf = (caseId: string, folio: string): CaseDetail => ({
  case: { ...ITEM, case_id: caseId, folio, text: 'Hola.', manual_reruns: 0 },
  runs: [],
  resolution: null,
  proposal: null,
  override_options: null,
});

const status = (agent: 'on' | 'off' | 'no_api_key') => Response.json({ agent });

afterEach(cleanup);

describe('workspace (04 Step 7)', () => {
  it('warns that the agent is off, as the kill switch leaves it', async () => {
    renderWithApi(<Workspace />, {
      'GET /status': status('off'),
      'GET /cases': Response.json([]),
    });
    expect((await screen.findByRole('status')).textContent).toBe(
      'El agente está apagado. Cada caso nuevo llega a revisión sin investigar, con «Responder sin acción» y la respuesta en blanco.',
    );
  });

  it('warns that the agent has no API key', async () => {
    renderWithApi(<Workspace />, {
      'GET /status': status('no_api_key'),
      'GET /cases': Response.json([]),
    });
    expect((await screen.findByRole('status')).textContent).toBe(
      'El agente no tiene clave de API. Cada caso nuevo queda como fallido, sin propuesta, hasta que alguien la configure.',
    );
  });

  it('shows no banner while the agent is on', async () => {
    renderWithApi(<Workspace />, {
      'GET /status': status('on'),
      'GET /cases': Response.json([]),
    });
    await screen.findByText('Elige un caso de la bandeja o crea uno nuevo.');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('opens a case from the inbox, and closes it back onto its row', async () => {
    renderWithApi(<Workspace />, {
      'GET /status': status('on'),
      'GET /cases': Response.json([ITEM]),
      'GET /cases/case_abc': Response.json(
        detailOf('case_abc', 'AC-K55M-76NH'),
      ),
    });
    const row = await screen.findByRole('button', { name: /AC-K55M-76NH/ });
    fireEvent.click(row);
    expect(
      await screen.findByRole('heading', { name: 'Caso AC-K55M-76NH' }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Volver a la bandeja' }),
    );
    expect(
      screen.queryByRole('heading', { name: 'Caso AC-K55M-76NH' }),
    ).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it('closes the new case form back onto the button that opened it', async () => {
    renderWithApi(<Workspace />, {
      'GET /status': status('on'),
      'GET /cases': Response.json([]),
      'GET /customers': Response.json([{ id: 'cus_01', first_name: 'Ana' }]),
    });
    const newCase = await screen.findByRole('button', { name: 'Nuevo caso' });
    fireEvent.click(newCase);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('heading', { name: 'Nuevo caso' })).toBeNull();
    expect(document.activeElement).toBe(newCase);
  });

  it('opens a new case from the form, shows it, and refreshes the inbox', async () => {
    const { seen } = renderWithApi(<Workspace />, {
      'GET /status': status('on'),
      'GET /cases': Response.json([]),
      'GET /customers': Response.json([{ id: 'cus_01', first_name: 'Ana' }]),
      'POST /cases': Response.json(
        { case_id: 'case_new', folio: 'AC-N3W0-CA5E' },
        { status: ACCEPTED },
      ),
      'GET /cases/case_new': Response.json(
        detailOf('case_new', 'AC-N3W0-CA5E'),
      ),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Nuevo caso' }));
    await screen.findByRole('option', { name: 'Ana · cus_01' });
    fireEvent.change(screen.getByLabelText('Cliente'), {
      target: { value: 'cus_01' },
    });
    fireEvent.change(screen.getByLabelText('Mensaje del cliente'), {
      target: { value: 'Hola.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear caso' }));
    expect(
      await screen.findByRole('heading', { name: 'Caso AC-N3W0-CA5E' }),
    ).toBeTruthy();
    await vi.waitFor(() => {
      const log = seen.map(({ method, url }) => `${method} ${url}`);
      expect(log.slice(log.indexOf('POST /cases'))).toContain('GET /cases');
    });
  });
});
