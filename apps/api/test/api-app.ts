import { randomUUID } from 'node:crypto';

import type {
  ActionType,
  CaseFlag,
  CaseStatus,
  CoreClient,
  ReviewTier,
} from '@fintech-agent/contracts';
import type { INestApplication, LoggerService } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Sql } from 'postgres';

import { CORE_CLIENT } from '../src/approvals/approvals.module.js';
import { AppModule } from '../src/app.module.js';
import { loadApiConfig } from '../src/config.js';
import { HTTP_APP_OPTIONS, configureHttpApp } from '../src/http-app.js';
import type { TestDatabase } from './database.js';

export const ANA = 'dev-operator-ana-token-0123456789';
export const BETO = 'dev-operator-beto-token-0123456789';
const OPERATOR_TOKENS = `ana:k1:${ANA},beto:k2:${BETO}`;
/** The webhook secret the test app verifies against (`whsec_` + base64). */
export const WEBHOOK_SECRET = `whsec_${Buffer.from('webhook-secret-for-api-tests-0123').toString('base64')}`;
/** The status codes the gate answers with. */
export const HTTP = {
  ok: 200,
  badRequest: 400,
  unauthorized: 401,
  notFound: 404,
  conflict: 409,
  accepted: 202,
  tooLarge: 413,
  unsupported: 415,
  unavailable: 503,
} as const;

/** A core-mock that holds nothing, for routes that never read it. */
export const NO_CORE: CoreClient = {
  customer: () => Promise.resolve(null),
  transaction: () => Promise.resolve(null),
  transactions: () => Promise.resolve(null),
};

// A worker's lease on a case seeded mid-investigation, long enough to outlast a test.
const CLAIM_LEASE_MS = 300_000;

export const DRAFT = 'Hola Ana, registramos tu aclaración con folio {{folio}}.';

/** The real `AppModule` as `copilot_api`, with core-mock replaced by `core`. */
export async function startApiApp(
  db: TestDatabase,
  core: CoreClient,
  logger: LoggerService | false = false,
): Promise<{ app: INestApplication; base: string }> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule.register({
        ...loadApiConfig({
          API_DATABASE_URL: db.urlFor('copilot_api'),
          OPERATOR_TOKENS,
          CORE_MOCK_URL: 'http://core-mock.invalid',
          CORE_READ_KEY: 'unused-in-tests',
          AGENT_WORKER: 'off',
          MCP_URL: 'http://mcp.invalid/mcp',
          MCP_AUDIENCE: 'http://mcp:3020/mcp',
          CASE_TOKEN_KEY: 'unused-in-tests-case-token-key-0123',
          WEBHOOK_SECRET,
        }),
        API_PORT: 0,
      }),
    ],
  })
    .overrideProvider(CORE_CLIENT)
    .useValue(core)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    ...HTTP_APP_OPTIONS,
    logger,
  });
  configureHttpApp(app);
  await app.listen(0, '127.0.0.1');
  return { app, base: await app.getUrl() };
}

export interface ProposalFixture {
  flags?: CaseFlag[];
  tier?: ReviewTier | null;
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
  const claimed = fixture.caseStatus === 'investigating';
  const params = {
    transaction_ids: fixture.transactionIds ?? ['tx_c1'],
    reason_code: 'unrecognized_charge',
  };
  await owner`
    insert into cases (id, ticket_id, folio, received_at, source, customer_id, text_masked, status, flags, review_tier, category, claim_token, locked_until)
    values (${caseId}, ${`T-${caseId}`}, ${`AC-${key.toUpperCase().padStart(4, '0')}-TEST`}, now(), 'webhook', 'cus_01', 'hola',
      ${fixture.caseStatus ?? 'needs_review'}, ${owner.json(fixture.flags ?? [])}, ${fixture.tier === undefined ? 'standard' : fixture.tier}, 'unrecognized_card_charge',
      ${claimed ? randomUUID() : null}, ${claimed ? new Date(Date.now() + CLAIM_LEASE_MS) : null})`;

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
