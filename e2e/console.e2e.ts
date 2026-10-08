import { expect, test, type Locator, type Page } from '@playwright/test';

import { coreWritesFor, database, operatorToken, run } from './stack.js';

// Needs a fresh stack with the kill switch on (04 Step 7): every case reaches
// review through the fallback, so nothing here calls a model. Each run leaves
// undecided canaries in the inbox, so start from empty volumes:
//   docker compose down -v && AGENT_MODE=off docker compose up -d --build --wait
//   pnpm --filter @fintech-agent/e2e exec playwright install chromium && pnpm e2e

const CUSTOMER = 'cus_07';
const REPLY = 'Hola, abrimos la aclaración de tu cargo de PAYPAL.';
const AWAITING = 'Por revisar';
const INJECTION = 'Posible instrucción en el texto del cliente';
const FALLBACK = 'Propuesta de respaldo, sin investigación completa';
// With the kill switch on, the injection scan still runs; every case falls back.
const DEMO_FLAGS: Record<string, readonly string[]> = {
  'tkt-adv-01': [INJECTION, FALLBACK],
  'tkt-adv-06': [FALLBACK],
};
const DEMO_TICKETS = Object.keys(DEMO_FLAGS);
const WRITE_WAIT_MS = 30_000;
const NO_CANARY_SPREAD = { CANARY_SPREAD_MS: '0' };

const sql = database();
test.afterAll(() => sql.end());

// Every page must load with no script error and no CSP violation (02 G7);
// Chrome reports a CSP violation as a console error.
let browserErrors: string[] = [];
test.beforeEach(({ page }) => {
  browserErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
});
test.afterEach(() => {
  expect(browserErrors).toEqual([]);
});

const button = (page: Page, name: string | RegExp): Locator =>
  page.getByRole('button', { name });
const checkboxes = (page: Page, name: string | RegExp): Locator =>
  page.getByRole('checkbox', { name });

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Token de operador').fill(operatorToken());
  await button(page, 'Entrar').click();
  await expect(button(page, 'Cerrar sesión')).toBeVisible();
}

async function waitForReview(page: Page): Promise<void> {
  await expect(page.locator('.case-meta')).toContainText(AWAITING);
}

async function checkAll(boxes: Locator): Promise<void> {
  for (const box of await boxes.all()) await box.check();
}

async function decisionPanel(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { name: 'Tu decisión' }),
  ).toBeVisible();
}

interface Action {
  id: string;
  type: string;
  status: string;
  final_reply: string | null;
}

async function actionOf(caseFolio: string): Promise<Action> {
  const [row] = await sql<Action[]>`
    select p.id, p.type, p.status, p.final_reply from proposed_actions p
    join cases c on c.id = p.case_id
    where c.folio = ${caseFolio}
    order by p.proposed_at desc limit 1`;
  if (!row) throw new Error(`no proposal for ${caseFolio}`);
  return row;
}

const executionsOf = async (actionId: string): Promise<string[]> =>
  (
    await sql<{ status: string }[]>`
      select status from action_executions where action_id = ${actionId}`
  ).map(({ status }) => status);

test('an operator opens a case in the form, overrides it to a dispute with an edited reply, and the executor writes once', async ({
  page,
}) => {
  await signIn(page);
  await button(page, 'Nuevo caso').click();
  await page.getByLabel('Cliente', { exact: true }).selectOption(CUSTOMER);
  await page
    .getByLabel('Mensaje del cliente')
    .fill('No reconozco un cargo de PAYPAL por 899 en mi tarjeta.');
  await button(page, 'Crear caso').click();
  const heading = page.getByRole('heading', { name: /^Caso AC-/ });
  await expect(heading).toBeVisible();
  const folio = (await heading.textContent())?.replace('Caso', '').trim() ?? '';
  await waitForReview(page);
  await decisionPanel(page);

  await checkAll(checkboxes(page, /^Enterado:/));
  await checkboxes(page, 'Cambiar la acción propuesta').check();
  await page.getByLabel('Acción', { exact: true }).selectOption('open_dispute');
  await checkboxes(page, /PAYPAL/)
    .first()
    .check();
  await page
    .getByLabel('Motivo', { exact: true })
    .selectOption('unrecognized_charge');
  await page.getByLabel('Respuesta al cliente', { exact: true }).fill(REPLY);
  await button(page, /^Abrir aclaración sobre tx_/).click();

  await expect(page.getByRole('article').getByRole('status')).toHaveText(
    'Aprobaste la propuesta. El ejecutor aplicará la acción.',
  );
  await expect(page.locator('.case-meta')).toContainText('Resuelto');
  const action = await actionOf(folio);
  await expect
    .poll(() => executionsOf(action.id), { timeout: WRITE_WAIT_MS })
    .toEqual(['executed']);
  const decided = await actionOf(folio);
  expect(decided).toMatchObject({
    type: 'open_dispute',
    status: 'executed',
    final_reply: REPLY,
  });
  const audited = await sql<{ event: string }[]>`
    select event from audit_log where actor = 'executor' and ref = ${action.id}`;
  expect(audited.map(({ event }) => event)).toEqual(['execution.executed']);
  expect(coreWritesFor(action.id)).toBe(1);
});

test('pnpm demo:post ADV-01 ADV-06 shows both cases in the inbox with their flags', async ({
  page,
}) => {
  run('pnpm', ['demo:post', 'ADV-01', 'ADV-06']);
  const posted = await sql<{ folio: string; ticket_id: string }[]>`
    select folio, ticket_id from cases where ticket_id in ${sql(DEMO_TICKETS)}`;
  expect(posted).toHaveLength(DEMO_TICKETS.length);

  await signIn(page);
  for (const { folio, ticket_id } of posted) {
    const row = button(page, new RegExp(folio));
    await expect(row).toContainText(AWAITING);
    await expect(row.locator('.flag-chip')).toHaveText([
      ...(DEMO_FLAGS[ticket_id] ?? []),
    ]);
  }
});

test('an injected canary looks like any case, and approving it ends canary_missed with no write', async ({
  page,
}) => {
  run('pnpm', ['canary:inject'], NO_CANARY_SPREAD);
  const [canary] = await sql<{ folio: string }[]>`
    select c.folio from canary_cases k join cases c on c.id = k.case_id
    order by c.received_at desc limit 1`;
  if (!canary) throw new Error('canary:inject wrote no case');

  await signIn(page);
  const row = button(page, new RegExp(canary.folio));
  await expect(row).toContainText(AWAITING);
  await expect(page.getByText(/canario/i)).toHaveCount(0);
  await row.click();
  await waitForReview(page);
  await decisionPanel(page);
  await expect(page.getByText(/canario/i)).toHaveCount(0);

  await checkAll(checkboxes(page, /^Enterado:/));
  await checkAll(checkboxes(page, /^Revisé/));
  const reply = page.getByLabel('Respuesta al cliente', { exact: true });
  if ((await reply.inputValue()).trim() === '') await reply.fill(REPLY);
  await button(page, 'Responder sin acción').click();

  await expect(page.getByRole('article').getByRole('status')).toHaveText(
    /^Este caso era un canario.*Se aprobó sin detectarlo; no se ejecuta nada\.$/,
  );
  // With the kill switch the canary's proposal is the fallback `none`, which
  // never writes anyway; the trigger refusing a canary's execution is proven
  // in approvals.int.spec. This run proves the status and the told outcome.
  const action = await actionOf(canary.folio);
  expect(action).toMatchObject({ type: 'none', status: 'canary_missed' });
  expect(await executionsOf(action.id)).toEqual([]);
  expect(coreWritesFor(action.id)).toBe(0);
});

test('the shell names the operator, and signing out forgets the session until the next sign-in', async ({
  page,
}) => {
  await signIn(page);
  await expect(page.locator('.shell-operator')).toContainText('ana');
  await button(page, 'Cerrar sesión').click();
  await expect(page.getByLabel('Token de operador')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  await page.reload();
  await expect(page.getByLabel('Token de operador')).toBeVisible();
  await signIn(page);
  await expect(page.locator('.shell-operator')).toContainText('ana');
});
