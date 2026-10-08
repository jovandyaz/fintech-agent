import type { CaseDetail } from '@fintech-agent/contracts/console';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RUN, detail as caseDetail } from '../test/case-detail.js';
import { heldAnswer, renderWithApi } from '../test/harness.js';
import { CaseView } from './CaseView.js';

const NOT_FOUND = 404;
// What a customer can send (Review Focus 3): markup, script, a Markdown link
// and a zero-width character, all of which must show as typed.
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const HOSTILE_TEXT = `Hola <img src=x onerror=alert(1)><script>alert(2)</script> [verifica aquí](http://evil.example) cargo${ZERO_WIDTH_SPACE}de 899`;

const detail = (text: string | null): CaseDetail => ({
  case: {
    case_id: 'case_abc',
    folio: 'AC-K55M-76NH',
    status: 'needs_review',
    review_tier: 'high',
    flags: ['injection_signal'],
    category: 'unrecognized_card_charge',
    received_at: '2026-10-07T21:00:00.000Z',
    text,
    manual_reruns: 0,
  },
  runs: [],
  resolution: null,
  proposal: null,
  override_options: null,
});

afterEach(cleanup);

describe('case view (04 Step 7, 02 G7)', () => {
  it('heads the case with its folio, status, tier and category', async () => {
    renderWithApi(<CaseView caseId="case_abc" onClose={vi.fn()} />, {
      'GET /cases/case_abc': Response.json(detail('Hola.')),
    });
    expect(
      await screen.findByRole('heading', { name: 'Caso AC-K55M-76NH' }),
    ).toBeTruthy();
    expect(screen.getByText('Por revisar')).toBeTruthy();
    expect(screen.getByText('Prioridad alta')).toBeTruthy();
    expect(screen.getByText('Cargo con tarjeta no reconocido')).toBeTruthy();
  });

  it('moves focus to the case heading once the case loads', async () => {
    renderWithApi(<CaseView caseId="case_abc" onClose={vi.fn()} />, {
      'GET /cases/case_abc': Response.json(detail('Hola.')),
    });
    const heading = await screen.findByRole('heading', {
      name: 'Caso AC-K55M-76NH',
    });
    expect(document.activeElement).toBe(heading);
  });

  it('asks the api for the case by its id as one path segment', async () => {
    const { seen } = renderWithApi(
      <CaseView caseId="a/b?c" onClose={vi.fn()} />,
      { 'GET /cases/a%2Fb%3Fc': Response.json(detail('Hola.')) },
    );
    await screen.findByRole('heading', { name: 'Caso AC-K55M-76NH' });
    expect(seen.map(({ url }) => url)).toEqual(['/cases/a%2Fb%3Fc']);
  });

  it('can go back to the inbox while the case is still loading', () => {
    const onClose = vi.fn();
    const held = heldAnswer(Response.json(detail('Hola.')));
    renderWithApi(<CaseView caseId="case_abc" onClose={onClose} />, {
      'GET /cases/case_abc': held.answer,
    });
    expect(screen.getByText('Cargando el caso…')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Volver a la bandeja' }),
    );
    expect(onClose).toHaveBeenCalled();
    held.release();
  });

  it("shows the customer's text exactly as typed, never as markup", async () => {
    const { container } = renderWithApi(
      <CaseView caseId="case_abc" onClose={vi.fn()} />,
      { 'GET /cases/case_abc': Response.json(detail(HOSTILE_TEXT)) },
    );
    const text = await screen.findByTestId('customer-text');
    expect(text.textContent).toBe(HOSTILE_TEXT);
    expect(container.querySelector('img, script, a')).toBeNull();
  });

  it('shows the proposal: action, reason, transactions, justification, reasoning and cited policies', async () => {
    renderWithApi(<CaseView caseId="case_abc" onClose={vi.fn()} />, {
      'GET /cases/case_abc': Response.json(caseDetail()),
    });
    const proposal = await screen.findByRole('region', {
      name: 'Propuesta del agente',
    });
    const inProposal = within(proposal);
    expect(inProposal.getByText('Abrir aclaración')).toBeTruthy();
    expect(inProposal.getByText('Cargo no reconocido')).toBeTruthy();
    expect(inProposal.getByText(/^tx_card01 · PAYPAL \*TIENDA/)).toBeTruthy();
    expect(
      inProposal.getByText('El cliente no reconoce el cargo de PAYPAL.'),
    ).toBeTruthy();
    expect(
      inProposal.getByText('El cargo coincide con el texto del cliente.'),
    ).toBeTruthy();
    expect(inProposal.getByText('pol-03 · Cargos no reconocidos')).toBeTruthy();
    expect(
      inProposal.getByText('El cliente puede pedir la aclaración de un cargo.'),
    ).toBeTruthy();
  });

  it('says when the agent proposed nothing to decide', async () => {
    renderWithApi(<CaseView caseId="case_abc" onClose={vi.fn()} />, {
      'GET /cases/case_abc': Response.json(
        caseDetail({ proposal: null, resolution: null, runs: [] }),
      ),
    });
    expect(
      await screen.findByText(
        'Este caso todavía no tiene propuesta del agente.',
      ),
    ).toBeTruthy();
  });

  it('shows every text from the customer, the policies and the model exactly as typed, never as markup', async () => {
    const data = caseDetail();
    const hostile = {
      ...data,
      case: { ...data.case, text: HOSTILE_TEXT },
      resolution: {
        ...data.resolution!,
        draft_reply: HOSTILE_TEXT,
        reasoning_summary: HOSTILE_TEXT,
        citations: [
          {
            ...data.resolution!.citations[0]!,
            section: HOSTILE_TEXT,
            quote: HOSTILE_TEXT,
          },
        ],
      },
      proposal: { ...data.proposal!, justification: HOSTILE_TEXT },
      runs: [
        {
          ...RUN,
          steps: [{ ...RUN.steps[1]!, output: { note: HOSTILE_TEXT } }],
        },
      ],
    };
    const { container } = renderWithApi(
      <CaseView caseId="case_abc" onClose={vi.fn()} />,
      { 'GET /cases/case_abc': Response.json(hostile) },
    );
    await screen.findByRole('region', { name: 'Propuesta del agente' });
    expect(screen.getByTestId('customer-text').textContent).toBe(HOSTILE_TEXT);
    expect(screen.getByTestId('justification').textContent).toBe(HOSTILE_TEXT);
    expect(screen.getByTestId('reasoning').textContent).toBe(HOSTILE_TEXT);
    expect(screen.getByTestId('citation-quote').textContent).toBe(HOSTILE_TEXT);
    expect(screen.getByTestId('citation-source').textContent).toBe(
      `pol-03 · ${HOSTILE_TEXT}`,
    );
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Respuesta al cliente').value,
    ).toBe(HOSTILE_TEXT);
    expect(screen.getByTestId('step-output').textContent).toBe(
      JSON.stringify({ note: HOSTILE_TEXT }, null, 2),
    );
    expect(container.querySelector('img, script, a, iframe')).toBeNull();
  });

  it('says the text is not read yet while the case waits for the agent', async () => {
    renderWithApi(<CaseView caseId="case_abc" onClose={vi.fn()} />, {
      'GET /cases/case_abc': Response.json(detail(null)),
    });
    expect(
      await screen.findByText('El texto aparece cuando el agente lee el caso.'),
    ).toBeTruthy();
  });

  it('says when the case does not exist', async () => {
    renderWithApi(<CaseView caseId="case_abc" onClose={vi.fn()} />, {
      'GET /cases/case_abc': Response.json(
        { message: 'not_found' },
        { status: NOT_FOUND },
      ),
    });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'No pudimos abrir este caso.',
    );
  });

  it('can go back to the inbox from a case that did not open', async () => {
    const onClose = vi.fn();
    renderWithApi(<CaseView caseId="case_abc" onClose={onClose} />, {});
    await screen.findByRole('alert');
    fireEvent.click(
      screen.getByRole('button', { name: 'Volver a la bandeja' }),
    );
    expect(onClose).toHaveBeenCalled();
  });
});
