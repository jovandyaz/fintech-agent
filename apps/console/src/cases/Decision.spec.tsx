import {
  APPROVED_FACTOR_WARNINGS,
  MAX_REPLY_CHARS,
  type CaseDetail,
} from '@fintech-agent/contracts/console';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CARD_CHARGE,
  OTHER_CHARGE,
  SPEI_OUT,
  detail,
} from '../test/case-detail.js';
import { heldAnswer, renderWithApi, type Routes } from '../test/harness.js';
import { CaseView } from './CaseView.js';

const BAD_REQUEST = 400;
const CONFLICT = 409;
const DECISION = 'POST /actions/act_abc/decision';
const DRAFT = 'Hola, abrimos una aclaración por tu cargo.';
const APPROVE_DISPUTE = 'Abrir aclaración sobre tx_card01';
const FLAG_ACK = 'Enterado: Posible fraude de primera parte';
const CANARY = /canario/i;

const resolvedAs = (status: 'approved' | 'rejected'): CaseDetail => {
  const data = detail();
  return {
    ...data,
    case: { ...data.case, status: 'resolved' },
    proposal: { ...data.proposal!, status },
  };
};
// The case as the api answers it before and after the decision.
const decidedOnSecondRead = (after: CaseDetail) => {
  const reads = [detail(), after];
  return () => Response.json(reads.shift() ?? after);
};

const answer = (status: string) =>
  Response.json({ action_id: 'act_abc', status });

const openCase = (data: CaseDetail, routes: Routes = {}) =>
  renderWithApi(<CaseView caseId="case_abc" onClose={vi.fn()} />, {
    'GET /cases/case_abc': Response.json(data),
    ...routes,
  });

const button = (name: string | RegExp) =>
  screen.getByRole<HTMLButtonElement>('button', { name });
const check = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole('checkbox', { name }));
const reply = () =>
  screen.getByLabelText<HTMLTextAreaElement>('Respuesta al cliente');
const sentBody = (seen: { method: string; body: unknown }[]) =>
  seen.find(({ method }) => method === 'POST')?.body;

afterEach(cleanup);

describe('decision panel (02 G3)', () => {
  it('moves focus to what the decision did once the case is resolved', async () => {
    renderWithApi(<CaseView caseId="case_abc" onClose={vi.fn()} />, {
      'GET /cases/case_abc': decidedOnSecondRead(resolvedAs('rejected')),
      [DECISION]: answer('rejected'),
    });
    await screen.findByRole('button', { name: 'Rechazar propuesta' });
    fireEvent.change(screen.getByLabelText('Motivo del rechazo'), {
      target: { value: 'tone' },
    });
    button('Rechazar propuesta').focus();
    fireEvent.click(button('Rechazar propuesta'));
    await screen.findByText('Estado de la propuesta: Rechazada');
    expect(document.activeElement).toBe(screen.getByRole('status'));
  });

  it('drops what the last decision did once the case is sent back to the agent', async () => {
    const reads = [detail(), resolvedAs('rejected')];
    const after = resolvedAs('rejected');
    renderWithApi(<CaseView caseId="case_abc" onClose={vi.fn()} />, {
      'GET /cases/case_abc': () => Response.json(reads.shift() ?? after),
      [DECISION]: answer('rejected'),
      'POST /cases/case_abc/rerun': Response.json({
        case_id: 'case_abc',
        status: 'queued',
        manual_reruns: 1,
      }),
    });
    await screen.findByRole('button', { name: 'Rechazar propuesta' });
    fireEvent.change(screen.getByLabelText('Motivo del rechazo'), {
      target: { value: 'tone' },
    });
    fireEvent.click(button('Rechazar propuesta'));
    await screen.findByRole('status');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Volver a investigar' }),
    );
    await vi.waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('says what still keeps Approve and Reject off', async () => {
    openCase(detail());
    const approve = await screen.findByRole('button', {
      name: APPROVE_DISPUTE,
    });
    const hint = () =>
      document.getElementById(approve.getAttribute('aria-describedby') ?? '')
        ?.textContent;
    expect(hint()).toBe(
      'Para aprobar falta: confirmar cada alerta, revisar cada transacción.',
    );
    check(FLAG_ACK);
    check(/^Revisé tx_card01/);
    expect(approve.getAttribute('aria-describedby')).toBeNull();
    const reject = button('Rechazar propuesta');
    expect(
      document.getElementById(reject.getAttribute('aria-describedby') ?? '')
        ?.textContent,
    ).toBe('Para rechazar falta: elegir un motivo.');
    expect(
      screen.getByRole('group', { name: 'Rechazar la propuesta' }),
    ).toBeTruthy();
  });

  it('names what approving does on the Approve button', async () => {
    openCase(detail());
    expect(
      await screen.findByRole('button', { name: APPROVE_DISPUTE }),
    ).toBeTruthy();
  });

  it('keeps Approve off until each flag is acknowledged and, on a high case, each transaction checked off', async () => {
    const { seen } = openCase(detail(), { [DECISION]: answer('approved') });
    const approve = await screen.findByRole<HTMLButtonElement>('button', {
      name: APPROVE_DISPUTE,
    });
    expect(approve.disabled).toBe(true);
    check(FLAG_ACK);
    expect(approve.disabled).toBe(true);
    check(/^Revisé tx_card01/);
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    await vi.waitFor(() =>
      expect(sentBody(seen)).toEqual({
        decision: 'approve',
        final_reply: DRAFT,
        acknowledged_flags: ['first_party_signal'],
        reviewed_transaction_ids: [CARD_CHARGE.id],
      }),
    );
  });

  it('keeps Approve off on any case until each flag is acknowledged', async () => {
    const data = detail();
    openCase({
      ...data,
      case: {
        ...data.case,
        review_tier: 'standard',
        flags: ['first_party_signal', 'injection_signal'],
      },
    });
    await screen.findByRole('button', { name: APPROVE_DISPUTE });
    check(FLAG_ACK);
    expect(button(APPROVE_DISPUTE).disabled).toBe(true);
    check('Enterado: Posible instrucción en el texto del cliente');
    expect(button(APPROVE_DISPUTE).disabled).toBe(false);
  });

  it('asks for no check-off on a standard case without flags', async () => {
    const data = detail();
    const { seen } = openCase(
      { ...data, case: { ...data.case, review_tier: 'standard', flags: [] } },
      { [DECISION]: answer('approved') },
    );
    const approve = await screen.findByRole<HTMLButtonElement>('button', {
      name: APPROVE_DISPUTE,
    });
    expect(screen.queryByRole('checkbox', { name: /^Revisé/ })).toBeNull();
    fireEvent.click(approve);
    await vi.waitFor(() =>
      expect(sentBody(seen)).toMatchObject({
        acknowledged_flags: [],
        reviewed_transaction_ids: [],
      }),
    );
  });

  it('checks off a case the agent left without a tier, as a high one', async () => {
    const data = detail();
    openCase({ ...data, case: { ...data.case, review_tier: null, flags: [] } });
    await screen.findByRole('button', { name: APPROVE_DISPUTE });
    expect(button(APPROVE_DISPUTE).disabled).toBe(true);
    check(/^Revisé tx_card01/);
    expect(button(APPROVE_DISPUTE).disabled).toBe(false);
  });

  it('starts the reply from the draft and sends it as edited', async () => {
    const { seen } = openCase(
      {
        ...detail(),
        case: { ...detail().case, review_tier: 'standard', flags: [] },
      },
      { [DECISION]: answer('approved') },
    );
    await screen.findByRole('button', { name: APPROVE_DISPUTE });
    expect(reply().value).toBe(DRAFT);
    fireEvent.change(reply(), { target: { value: 'Hola Ana.' } });
    fireEvent.click(button(APPROVE_DISPUTE));
    await vi.waitFor(() =>
      expect(sentBody(seen)).toMatchObject({ final_reply: 'Hola Ana.' }),
    );
  });

  it('inserts an approved auth-factor warning where the cursor is', async () => {
    openCase(detail());
    await screen.findByRole('button', { name: APPROVE_DISPUTE });
    const [warning] = APPROVED_FACTOR_WARNINGS;
    fireEvent.change(reply(), { target: { value: 'Hola. Saludos.' } });
    reply().setSelectionRange('Hola.'.length, 'Hola.'.length);
    fireEvent.click(button(`Insertar: ${warning}`));
    expect(reply().value).toBe(`Hola. ${warning} Saludos.`);
  });

  it('does not insert a warning that would push the reply past its limit', async () => {
    openCase(detail());
    await screen.findByRole('button', { name: APPROVE_DISPUTE });
    const [warning] = APPROVED_FACTOR_WARNINGS;
    fireEvent.change(reply(), {
      target: { value: 'x'.repeat(MAX_REPLY_CHARS - warning.length) },
    });
    expect(button(`Insertar: ${warning}`).disabled).toBe(true);
  });

  it('leaves the cursor right after the warning it inserted', async () => {
    openCase(detail());
    await screen.findByRole('button', { name: APPROVE_DISPUTE });
    const [warning] = APPROVED_FACTOR_WARNINGS;
    fireEvent.change(reply(), { target: { value: 'Hola. Saludos.' } });
    reply().setSelectionRange('Hola.'.length, 'Hola.'.length);
    fireEvent.click(button(`Insertar: ${warning}`));
    expect(reply().selectionStart).toBe(`Hola. ${warning}`.length);
  });

  it('starts an override from an action it can offer when the proposed one no longer fits', async () => {
    const data = detail();
    openCase({
      ...data,
      override_options: {
        ...data.override_options!,
        actions: data.override_options!.actions.map((action) =>
          action.type === 'open_dispute'
            ? { ...action, transaction_ids: [] }
            : action,
        ),
      },
    });
    await screen.findByRole('button', { name: APPROVE_DISPUTE });
    check('Cambiar la acción propuesta');
    expect(screen.getByLabelText<HTMLSelectElement>('Acción').value).toBe(
      'resend_cep',
    );
    expect(button('Reenviar comprobante (CEP)')).toBeTruthy();
  });

  it('keeps Approve and Reject off while the reply is empty', async () => {
    const data = detail();
    openCase({
      ...data,
      case: { ...data.case, review_tier: 'standard', flags: [] },
    });
    await screen.findByRole('button', { name: APPROVE_DISPUTE });
    fireEvent.change(reply(), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('Motivo del rechazo'), {
      target: { value: 'tone' },
    });
    expect(button(APPROVE_DISPUTE).disabled).toBe(true);
    expect(button('Rechazar propuesta').disabled).toBe(true);
  });

  it('overrides to another allowed action, naming it on the button, the picked transactions checked off', async () => {
    const { seen } = openCase(detail(), { [DECISION]: answer('approved') });
    await screen.findByRole('button', { name: APPROVE_DISPUTE });
    check(FLAG_ACK);
    check('Cambiar la acción propuesta');
    fireEvent.change(screen.getByLabelText('Acción'), {
      target: { value: 'escalate_fraud' },
    });
    check(/^tx_card02/);
    fireEvent.change(screen.getByLabelText('Motivo'), {
      target: { value: 'suspected_card_fraud' },
    });
    fireEvent.click(button('Escalar a fraude sobre tx_card02'));
    await vi.waitFor(() =>
      expect(sentBody(seen)).toEqual({
        decision: 'approve',
        final_reply: DRAFT,
        acknowledged_flags: ['first_party_signal'],
        reviewed_transaction_ids: [OTHER_CHARGE.id],
        override: {
          type: 'escalate_fraud',
          transaction_ids: [OTHER_CHARGE.id],
          reason_code: 'suspected_card_fraud',
        },
      }),
    );
  });

  it('offers for each action only the transactions it allows, and at least its minimum', async () => {
    openCase(detail());
    await screen.findByRole('button', { name: APPROVE_DISPUTE });
    check(FLAG_ACK);
    check('Cambiar la acción propuesta');
    fireEvent.change(screen.getByLabelText('Acción'), {
      target: { value: 'resend_cep' },
    });
    expect(screen.getByRole('checkbox', { name: /^tx_spei01/ })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /^tx_card01/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('Acción'), {
      target: { value: 'open_dispute' },
    });
    expect(screen.queryByRole('checkbox', { name: /^tx_spei01/ })).toBeNull();
    expect(button('Abrir aclaración').disabled).toBe(true);
    check(/^tx_card02/);
    expect(button('Abrir aclaración sobre tx_card02').disabled).toBe(false);
  });

  it('checks off an override on a standard case without flags too, by the picked transactions', async () => {
    const data = detail();
    const { seen } = openCase(
      { ...data, case: { ...data.case, review_tier: 'standard', flags: [] } },
      { [DECISION]: answer('approved') },
    );
    await screen.findByRole('button', { name: APPROVE_DISPUTE });
    check('Cambiar la acción propuesta');
    check(/^tx_card02/);
    fireEvent.click(button('Abrir aclaración sobre tx_card02'));
    await vi.waitFor(() =>
      expect(sentBody(seen)).toMatchObject({
        reviewed_transaction_ids: [OTHER_CHARGE.id],
        override: { transaction_ids: [OTHER_CHARGE.id] },
      }),
    );
  });

  it('offers no action the customer has too few transactions for', async () => {
    const data = detail();
    openCase({
      ...data,
      override_options: {
        ...data.override_options!,
        actions: data.override_options!.actions.map((action) =>
          action.type === 'resend_cep'
            ? { ...action, transaction_ids: [] }
            : action,
        ),
      },
    });
    await screen.findByRole('button', { name: APPROVE_DISPUTE });
    check('Cambiar la acción propuesta');
    const offered = [
      ...screen.getByLabelText<HTMLSelectElement>('Acción').options,
    ].map((option) => option.value);
    expect(offered).toEqual(['open_dispute', 'escalate_fraud', 'none']);
  });

  it('offers no decision while the case is not waiting for one', async () => {
    const data = detail();
    openCase({ ...data, case: { ...data.case, status: 'investigating' } });
    await screen.findByRole('region', { name: 'Propuesta del agente' });
    expect(screen.queryByLabelText('Respuesta al cliente')).toBeNull();
  });

  it('stops picking transactions at the action maximum', async () => {
    const data = detail();
    openCase({
      ...data,
      override_options: {
        actions: [
          {
            type: 'open_dispute',
            min: 1,
            max: 1,
            transaction_ids: [CARD_CHARGE.id, OTHER_CHARGE.id],
          },
        ],
        transactions: [CARD_CHARGE, OTHER_CHARGE, SPEI_OUT],
      },
    });
    await screen.findByRole('button', { name: APPROVE_DISPUTE });
    check('Cambiar la acción propuesta');
    check(/^tx_card01/);
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: /^tx_card02/ })
        .disabled,
    ).toBe(true);
  });

  it('offers no override while the core cannot list the transactions', async () => {
    openCase({ ...detail(), override_options: null });
    await screen.findByRole('button', { name: APPROVE_DISPUTE });
    expect(
      screen.queryByRole('checkbox', { name: 'Cambiar la acción propuesta' }),
    ).toBeNull();
    expect(
      screen.getByText(
        'Otra acción no está disponible mientras el core no responde.',
      ),
    ).toBeTruthy();
  });

  it('rejects only with a reject code, the internal note sent only when written', async () => {
    const { seen } = openCase(detail(), { [DECISION]: answer('rejected') });
    const reject = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Rechazar propuesta',
    });
    expect(reject.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Motivo del rechazo'), {
      target: { value: 'wrong_action' },
    });
    fireEvent.click(reject);
    await vi.waitFor(() =>
      expect(sentBody(seen)).toEqual({
        decision: 'reject',
        final_reply: DRAFT,
        acknowledged_flags: [],
        reject_code: 'wrong_action',
      }),
    );
  });

  it('sends the internal note with a rejection when there is one', async () => {
    const { seen } = openCase(detail(), { [DECISION]: answer('rejected') });
    await screen.findByRole('button', { name: 'Rechazar propuesta' });
    fireEvent.change(screen.getByLabelText('Motivo del rechazo'), {
      target: { value: 'tone' },
    });
    fireEvent.change(
      screen.getByLabelText('Nota interna (no se envía al cliente)'),
      { target: { value: 'Muy seco.' } },
    );
    fireEvent.click(button('Rechazar propuesta'));
    await vi.waitFor(() =>
      expect(sentBody(seen)).toMatchObject({ reject_reason: 'Muy seco.' }),
    );
  });

  it('says what an approval does, and nothing about canaries', async () => {
    openCase(detail(), { [DECISION]: answer('approved') });
    await screen.findByRole('button', { name: APPROVE_DISPUTE });
    expect(screen.queryByText(CANARY)).toBeNull();
    check(FLAG_ACK);
    check(/^Revisé tx_card01/);
    fireEvent.click(button(APPROVE_DISPUTE));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Aprobaste la propuesta. El ejecutor aplicará la acción.',
    );
    expect(screen.queryByText(CANARY)).toBeNull();
  });

  it('tells the operator a rejected proposal was a canary they caught, only after deciding', async () => {
    openCase(detail(), { [DECISION]: answer('canary_caught') });
    await screen.findByRole('button', { name: 'Rechazar propuesta' });
    expect(screen.queryByText(CANARY)).toBeNull();
    fireEvent.change(screen.getByLabelText('Motivo del rechazo'), {
      target: { value: 'wrong_transactions' },
    });
    fireEvent.click(button('Rechazar propuesta'));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Este caso era un canario: una propuesta con un defecto plantado para medir la revisión. Lo detectaste; no se ejecuta nada.',
    );
  });

  it('tells the operator an approved proposal was a canary they missed', async () => {
    openCase(detail(), { [DECISION]: answer('canary_missed') });
    await screen.findByRole('button', { name: APPROVE_DISPUTE });
    check(FLAG_ACK);
    check(/^Revisé tx_card01/);
    fireEvent.click(button(APPROVE_DISPUTE));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Este caso era un canario: una propuesta con un defecto plantado para medir la revisión. Se aprobó sin detectarlo; no se ejecuta nada.',
    );
  });

  it('names the checks a refused reply failed', async () => {
    openCase(detail(), {
      [DECISION]: Response.json(
        { message: 'invalid_reply', codes: ['LINK_IN_REPLY', 'PII_IN_REPLY'] },
        { status: BAD_REQUEST },
      ),
    });
    await screen.findByRole('button', { name: 'Rechazar propuesta' });
    fireEvent.change(screen.getByLabelText('Motivo del rechazo'), {
      target: { value: 'tone' },
    });
    fireEvent.click(button('Rechazar propuesta'));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'La respuesta no pasa estas revisiones: tiene un enlace; tiene datos personales.',
    );
  });

  it('says the case changed when the decision conflicts, keeping the edited reply', async () => {
    const { seen } = openCase(detail(), {
      [DECISION]: Response.json({ message: 'conflict' }, { status: CONFLICT }),
    });
    await screen.findByRole('button', { name: 'Rechazar propuesta' });
    fireEvent.change(reply(), { target: { value: 'Hola Ana.' } });
    fireEvent.change(screen.getByLabelText('Motivo del rechazo'), {
      target: { value: 'tone' },
    });
    fireEvent.click(button('Rechazar propuesta'));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'El caso cambió mientras lo revisabas: ya se decidió o se volvió a investigar.',
    );
    await vi.waitFor(() =>
      expect(seen.filter(({ url }) => url === '/cases/case_abc')).toHaveLength(
        2,
      ),
    );
    expect(reply().value).toBe('Hola Ana.');
  });

  it('lets the operator try again after a refused decision', async () => {
    const answers = [
      Response.json(
        { message: 'invalid_reply', codes: ['LINK_IN_REPLY'] },
        { status: BAD_REQUEST },
      ),
      answer('rejected'),
    ];
    const { seen } = openCase(detail(), {
      [DECISION]: () => answers.shift() ?? answer('rejected'),
    });
    await screen.findByRole('button', { name: 'Rechazar propuesta' });
    fireEvent.change(screen.getByLabelText('Motivo del rechazo'), {
      target: { value: 'tone' },
    });
    fireEvent.click(button('Rechazar propuesta'));
    await screen.findByRole('alert');
    fireEvent.change(reply(), { target: { value: 'Hola Ana.' } });
    fireEvent.click(button('Rechazar propuesta'));
    await screen.findByRole('status');
    expect(seen.filter(({ method }) => method === 'POST')).toHaveLength(2);
  });

  it('starts a new proposal from its own draft, not the reply edited for the last one', async () => {
    const first = detail();
    const second = detail({
      proposal: { ...first.proposal!, action_id: 'act_def' },
      resolution: {
        ...first.resolution!,
        draft_reply: 'Hola, revisamos de nuevo.',
      },
    });
    const answers = [first, second];
    renderWithApi(<CaseView caseId="case_abc" onClose={vi.fn()} />, {
      'GET /cases/case_abc': () => Response.json(answers.shift() ?? second),
      'POST /cases/case_abc/rerun': Response.json({
        case_id: 'case_abc',
        status: 'queued',
        manual_reruns: 1,
      }),
    });
    await screen.findByRole('button', { name: APPROVE_DISPUTE });
    fireEvent.change(reply(), { target: { value: 'Hola Ana.' } });
    fireEvent.click(button('Volver a investigar'));
    await vi.waitFor(() =>
      expect(reply().value).toBe('Hola, revisamos de nuevo.'),
    );
  });

  it('decides once however many times the operator clicks while it is sent', async () => {
    const held = heldAnswer(answer('rejected'));
    const { seen } = openCase(detail(), { [DECISION]: held.answer });
    await screen.findByRole('button', { name: 'Rechazar propuesta' });
    fireEvent.change(screen.getByLabelText('Motivo del rechazo'), {
      target: { value: 'tone' },
    });
    fireEvent.click(button('Rechazar propuesta'));
    fireEvent.click(button('Rechazar propuesta'));
    held.release();
    await screen.findByRole('status');
    expect(seen.filter(({ method }) => method === 'POST')).toHaveLength(1);
  });

  it('shows a decided proposal by its outcome, with nothing left to decide', async () => {
    const data = detail();
    openCase({
      ...data,
      case: { ...data.case, status: 'resolved' },
      proposal: { ...data.proposal!, status: 'rejected' },
    });
    expect(
      await screen.findByText('Estado de la propuesta: Rechazada'),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Rechazar propuesta' }),
    ).toBeNull();
    expect(screen.queryByLabelText('Respuesta al cliente')).toBeNull();
  });
});
