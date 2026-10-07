import type {
  ActionType,
  CaseFlag,
  CaseStatus,
  CoreClient,
} from '@fintech-agent/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Sql } from 'postgres';

import { CORE_CLIENT } from '../src/approvals/approvals.module.js';
import { AppModule } from '../src/app.module.js';
import type { TestDatabase } from './database.js';

export const ANA = 'dev-operator-ana-token-0123456789';
export const BETO = 'dev-operator-beto-token-0123456789';
const OPERATOR_TOKENS = `ana:k1:${ANA},beto:k2:${BETO}`;
export const DRAFT = 'Hola Ana, registramos tu aclaración con folio {{folio}}.';

/** The real `AppModule` as `copilot_api`, with core-mock replaced by `core`. */
export async function startApiApp(
  db: TestDatabase,
  core: CoreClient,
): Promise<{ app: INestApplication; base: string }> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule.register({
        API_DATABASE_URL: db.urlFor('copilot_api'),
        API_PORT: 0,
        OPERATOR_TOKENS,
        CORE_MOCK_URL: 'http://core-mock.invalid',
        CORE_READ_KEY: 'unused-in-tests',
      }),
    ],
  })
    .overrideProvider(CORE_CLIENT)
    .useValue(core)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  return { app, base: await app.getUrl() };
}

export interface ProposalFixture {
  flags?: CaseFlag[];
  tier?: 'standard' | 'high';
  canary?: boolean;
  type?: ActionType;
  transactionIds?: string[];
  caseStatus?: CaseStatus;
}

/** A case for `cus_01` with one run, its resolution and an open proposal, inserted as the owner. */
export async function seedProposal(
  owner: Sql,
  key: string,
  fixture: ProposalFixture = {},
): Promise<{ caseId: string; actionId: string }> {
  const caseId = `case_${key}`;
  const runId = `run_${key}`;
  const actionId = `act_${key}`;
  const type = fixture.type ?? 'open_dispute';
  const params = {
    transaction_ids: fixture.transactionIds ?? ['tx_c1'],
    reason_code: 'unrecognized_charge',
  };
  await owner`
    insert into cases (id, ticket_id, folio, received_at, source, customer_id, text_masked, status, flags, review_tier, category)
    values (${caseId}, ${`T-${caseId}`}, ${`AC-${key.toUpperCase().padStart(4, '0')}-TEST`}, now(), 'webhook', 'cus_01', 'hola',
      ${fixture.caseStatus ?? 'needs_review'}, ${owner.json(fixture.flags ?? [])}, ${fixture.tier ?? 'standard'}, 'unrecognized_card_charge')`;
  await owner`
    insert into agent_runs (id, case_id, variant, model, prompt_version)
    values (${runId}, ${caseId}, 'v1', 'model', 'p1')`;
  await owner`
    insert into resolutions (run_id, category, draft_reply, citations, abstained, reasoning_summary)
    values (${runId}, 'unrecognized_card_charge', ${DRAFT}, '[]', false, 'x')`;
  await owner`
    insert into proposed_actions (id, case_id, run_id, agent_type, agent_params, type, params, justification, is_canary)
    values (${actionId}, ${caseId}, ${runId}, ${type}, ${owner.json(params)},
      ${type}, ${owner.json(params)}, 'x', ${fixture.canary ?? false})`;
  return { caseId, actionId };
}
