import type { InboxItem } from '@fintech-agent/contracts/console';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { heldAnswer, renderWithApi } from '../test/harness.js';
import { Inbox } from './Inbox.js';

const SERVER_ERROR = 500;

const item = (over: Partial<InboxItem>): InboxItem => ({
  case_id: 'case_abc',
  folio: 'AC-K55M-76NH',
  status: 'needs_review',
  review_tier: 'standard',
  flags: [],
  category: 'unrecognized_card_charge',
  received_at: '2026-10-07T21:00:00.000Z',
  ...over,
});

const HIGH = item({
  case_id: 'case_high',
  folio: 'AC-H1GH-T1ER',
  review_tier: 'high',
  flags: ['action_fact_mismatch', 'first_party_signal'],
});
const STANDARD = item({ case_id: 'case_std', folio: 'AC-5TND-RD00' });
const EMPTY = 'No hay casos en la bandeja. Crea uno nuevo para empezar.';

afterEach(cleanup);

describe('inbox (04 Step 7)', () => {
  it('lists cases in the order the api gives, each with folio, status, tier and flags', async () => {
    renderWithApi(<Inbox onOpen={vi.fn()} onNewCase={vi.fn()} />, {
      'GET /cases': Response.json([HIGH, STANDARD]),
    });
    const rows = await screen.findAllByRole('listitem');
    expect(
      rows.map((row) => within(row).getByText(/^AC-/).textContent),
    ).toEqual(['AC-H1GH-T1ER', 'AC-5TND-RD00']);
    const high = within(rows[0]!);
    expect(high.getByText('Por revisar')).toBeTruthy();
    expect(high.getByText('Prioridad alta')).toBeTruthy();
    expect(high.getByText('La acción no se apoya en los datos')).toBeTruthy();
    expect(high.getByText('Posible fraude de primera parte')).toBeTruthy();
    expect(within(rows[1]!).queryByText('Prioridad alta')).toBeNull();
  });

  it('gives each case its category and the instant it arrived', async () => {
    renderWithApi(<Inbox onOpen={vi.fn()} onNewCase={vi.fn()} />, {
      'GET /cases': Response.json([STANDARD]),
    });
    const [row] = await screen.findAllByRole('listitem');
    expect(
      within(row!).getByText('Cargo con tarjeta no reconocido'),
    ).toBeTruthy();
    expect(row!.querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-10-07T21:00:00.000Z',
    );
  });

  it('says it is loading, not that it is empty, until the cases arrive', async () => {
    const held = heldAnswer(Response.json([]));
    renderWithApi(<Inbox onOpen={vi.fn()} onNewCase={vi.fn()} />, {
      'GET /cases': held.answer,
    });
    expect(screen.getByText('Cargando la bandeja…')).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    held.release();
    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText('Cargando la bandeja…')).toBeNull();
  });

  it('hides eval cases until the operator asks for them', async () => {
    const { seen } = renderWithApi(
      <Inbox onOpen={vi.fn()} onNewCase={vi.fn()} />,
      {
        'GET /cases': Response.json([STANDARD]),
        'GET /cases?include_eval=true': Response.json([STANDARD]),
      },
    );
    await screen.findAllByRole('listitem');
    fireEvent.click(screen.getByLabelText('Mostrar casos de evaluación'));
    await vi.waitFor(() =>
      expect(seen.map(({ url }) => url)).toContain('/cases?include_eval=true'),
    );
    expect(seen[0]?.url).toBe('/cases');
  });

  it('opens a case when its row is chosen', async () => {
    const onOpen = vi.fn();
    renderWithApi(<Inbox onOpen={onOpen} onNewCase={vi.fn()} />, {
      'GET /cases': Response.json([HIGH]),
    });
    fireEvent.click(
      await screen.findByRole('button', { name: /AC-H1GH-T1ER/ }),
    );
    expect(onOpen).toHaveBeenCalledWith('case_high');
  });

  it('marks the open case', async () => {
    renderWithApi(
      <Inbox selectedCaseId="case_std" onOpen={vi.fn()} onNewCase={vi.fn()} />,
      { 'GET /cases': Response.json([HIGH, STANDARD]) },
    );
    const open = await screen.findByRole('button', { name: /AC-5TND-RD00/ });
    expect(open.getAttribute('aria-current')).toBe('true');
    expect(
      screen
        .getByRole('button', { name: /AC-H1GH-T1ER/ })
        .getAttribute('aria-current'),
    ).toBeNull();
  });

  it('says when there are no cases, and offers to open one', async () => {
    const onNewCase = vi.fn();
    renderWithApi(<Inbox onOpen={vi.fn()} onNewCase={onNewCase} />, {
      'GET /cases': Response.json([]),
    });
    expect(await screen.findByText(EMPTY)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo caso' }));
    expect(onNewCase).toHaveBeenCalled();
  });

  it('says when the inbox cannot load', async () => {
    renderWithApi(<Inbox onOpen={vi.fn()} onNewCase={vi.fn()} />, {
      'GET /cases': new Response(null, { status: SERVER_ERROR }),
    });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'No pudimos cargar la bandeja. Lo intentamos de nuevo en unos segundos.',
    );
  });
});
