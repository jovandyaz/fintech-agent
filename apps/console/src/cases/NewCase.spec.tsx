import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { heldAnswer, renderWithApi } from '../test/harness.js';
import { NewCase } from './NewCase.js';

const ACCEPTED = 202;
const BAD_REQUEST = 400;
const UNAVAILABLE = 503;
const CUSTOMERS = Response.json([
  { id: 'cus_01', first_name: 'Ana' },
  { id: 'cus_02', first_name: 'Luis' },
]);
const OPENED = Response.json(
  { case_id: 'case_new', folio: 'AC-N3W0-CA5E' },
  { status: ACCEPTED },
);
const unavailable = () =>
  Response.json({ message: 'core_unavailable' }, { status: UNAVAILABLE });
const TEXT = 'No reconozco un cargo de PAYPAL por 899.';

const fill = (customer: string, text: string) => {
  fireEvent.change(screen.getByLabelText('Cliente'), {
    target: { value: customer },
  });
  fireEvent.change(screen.getByLabelText('Mensaje del cliente'), {
    target: { value: text },
  });
};

afterEach(cleanup);

describe('new case form (04 Step 7: it takes the real webhook path)', () => {
  it('offers each customer by first name and id', async () => {
    renderWithApi(<NewCase onOpened={vi.fn()} onCancel={vi.fn()} />, {
      'GET /customers': CUSTOMERS,
    });
    expect(
      await screen.findByRole('option', { name: 'Ana · cus_01' }),
    ).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Luis · cus_02' })).toBeTruthy();
  });

  it('opens the case through POST /cases and hands over its id', async () => {
    const onOpened = vi.fn();
    const { seen } = renderWithApi(
      <NewCase onOpened={onOpened} onCancel={vi.fn()} />,
      {
        'GET /customers': CUSTOMERS,
        'POST /cases': OPENED,
      },
    );
    await screen.findByRole('option', { name: 'Ana · cus_01' });
    fill('cus_01', TEXT);
    fireEvent.click(screen.getByRole('button', { name: 'Crear caso' }));
    await vi.waitFor(() => expect(onOpened).toHaveBeenCalledWith('case_new'));
    expect(seen.find(({ method }) => method === 'POST')?.body).toEqual({
      customer_id: 'cus_01',
      text: TEXT,
    });
  });

  it('opens one case however many times the operator clicks while it is sent', async () => {
    const onOpened = vi.fn();
    const held = heldAnswer(OPENED);
    const { seen } = renderWithApi(
      <NewCase onOpened={onOpened} onCancel={vi.fn()} />,
      { 'GET /customers': CUSTOMERS, 'POST /cases': held.answer },
    );
    await screen.findByRole('option', { name: 'Ana · cus_01' });
    fill('cus_01', TEXT);
    const create = screen.getByRole('button', { name: 'Crear caso' });
    fireEvent.click(create);
    fireEvent.click(create);
    held.release();
    await vi.waitFor(() => expect(onOpened).toHaveBeenCalled());
    expect(seen.filter(({ method }) => method === 'POST')).toHaveLength(1);
  });

  it('moves focus to the form heading when it opens', async () => {
    renderWithApi(<NewCase onOpened={vi.fn()} onCancel={vi.fn()} />, {
      'GET /customers': CUSTOMERS,
    });
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Nuevo caso' }),
    );
    await screen.findByRole('option', { name: 'Ana · cus_01' });
  });

  it('closes without sending when the operator cancels', async () => {
    const onCancel = vi.fn();
    const { seen } = renderWithApi(
      <NewCase onOpened={vi.fn()} onCancel={onCancel} />,
      { 'GET /customers': CUSTOMERS },
    );
    await screen.findByRole('option', { name: 'Ana · cus_01' });
    fill('cus_01', TEXT);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalled();
    expect(seen.filter(({ method }) => method === 'POST')).toHaveLength(0);
  });

  it('cannot be sent without a customer and a message', async () => {
    renderWithApi(<NewCase onOpened={vi.fn()} onCancel={vi.fn()} />, {
      'GET /customers': CUSTOMERS,
    });
    await screen.findByRole('option', { name: 'Ana · cus_01' });
    const create = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Crear caso',
    });
    expect(create.disabled).toBe(true);
    fill('cus_01', '   ');
    expect(create.disabled).toBe(true);
    fill('', TEXT);
    expect(create.disabled).toBe(true);
  });

  it('says when the case could not be created, and keeps the message', async () => {
    renderWithApi(<NewCase onOpened={vi.fn()} onCancel={vi.fn()} />, {
      'GET /customers': CUSTOMERS,
      'POST /cases': Response.json(
        { message: 'invalid_body' },
        { status: BAD_REQUEST },
      ),
    });
    await screen.findByRole('option', { name: 'Ana · cus_01' });
    fill('cus_01', TEXT);
    fireEvent.click(screen.getByRole('button', { name: 'Crear caso' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'No pudimos crear el caso. Revisa el cliente y el mensaje e intenta de nuevo.',
    );
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Mensaje del cliente').value,
    ).toBe(TEXT);
  });

  it('says when the customers cannot be loaded, and loads them again on request', async () => {
    const answers = [unavailable(), CUSTOMERS];
    renderWithApi(<NewCase onOpened={vi.fn()} onCancel={vi.fn()} />, {
      'GET /customers': () => answers.shift() ?? unavailable(),
    });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'No pudimos cargar los clientes.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(
      await screen.findByRole('option', { name: 'Ana · cus_01' }),
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
