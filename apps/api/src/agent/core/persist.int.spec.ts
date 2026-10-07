import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CONTAINER_START_MS,
  insertCase,
  startTestDatabase,
  type TestDatabase,
} from '../../../test/database.js';
import {
  RECEIVED_AT,
  cardAuth,
  cardRow,
  customerSeen,
  listed,
  policyChunk,
  resolutionOf,
  runOf,
  searched,
} from '../../../test/validator-fixtures.js';
import type { Database } from '../../database/index.js';
import * as schema from '../../database/schema.js';
import type { AgentOutcome, StepRecord } from './agent.js';
import { agentDisabled, persistRun, type PersistInput } from './persist.js';
import { StaleClaimError, type Claim } from './queue.js';
import { buildEvidence } from './validate/evidence.js';

const NOW = new Date('2026-10-07T15:03:00Z');
const STARTED_AT = new Date('2026-10-07T15:01:00Z');
const DAY_MS = 86_400_000;
// 02 G3 names the window; the test restates it so a drift in the code fails.
const LOOKBACK_MS = 120 * DAY_MS;
const VARIANT = 'A';
const PROMPT_VERSION = '0123456789abcdef';
const ACTOR = `agent:case-copilot/${VARIANT}@${PROMPT_VERSION}`;

let testDb: TestDatabase;
let owner: postgres.Sql;
let apiSql: postgres.Sql;
let db: Database;
let sequence = 0;

const evidence = buildEvidence(
  runOf([
    customerSeen,
    listed(cardRow({ auth_factors: 1 })),
    { tool: 'get_card_authorization', output: cardAuth({ auth_factors: 1 }) },
    searched(policyChunk()),
  ]),
);
const VALID_RUN = {
  kind: 'valid',
  resolution: resolutionOf(),
  conflicts: [],
  evidence,
  repaired: false,
} as const;
const VALID: AgentOutcome = { kind: 'validated', validation: VALID_RUN };
const BUDGET_STOP: AgentOutcome = {
  kind: 'stopped',
  stopReason: 'budget',
  reason: 'budget',
  evidence,
};

const step = (overrides: Partial<StepRecord> = {}): StepRecord => ({
  kind: 'llm',
  name: 'claude-sonnet-5-5',
  inputMasked: null,
  outputMasked: { text: 'ok' },
  inputTokens: 1_000,
  outputTokens: 200,
  cachedInputTokens: 300,
  costUsd: 0.0061,
  latencyMs: 900,
  providerRequestId: 'req_1',
  finishReason: 'tool-calls',
  ...overrides,
});
const TRACE: StepRecord[] = [
  step(),
  step({
    kind: 'tool',
    name: 'get_customer',
    inputMasked: {},
    outputMasked: { first_name: 'Ana' },
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    costUsd: null,
    latencyMs: 40,
    providerRequestId: null,
    finishReason: null,
  }),
  step({ inputTokens: 1_500, outputTokens: 400, costUsd: 0.0105 }),
];

interface Claimed {
  claim: Claim;
  runId: string;
}

async function claimedCase(customerId = 'cus_01'): Promise<Claimed> {
  const caseId = `case_p${++sequence}`;
  const runId = `run_p${sequence}`;
  const claim = { caseId, claimToken: randomUUID(), attempt: 1 };
  await insertCase(owner, caseId, customerId);
  await owner`
    update cases set status = 'investigating', received_at = ${RECEIVED_AT},
      claim_token = ${claim.claimToken}, locked_until = ${new Date(NOW.getTime() + 60_000)}, attempts = 1
    where id = ${caseId}`;
  await owner`
    insert into agent_runs (id, case_id, variant, model, prompt_version, started_at)
    values (${runId}, ${caseId}, ${VARIANT}, 'claude-sonnet-5-5', ${PROMPT_VERSION}, ${STARTED_AT})`;
  return { claim, runId };
}

const inputOf = (
  { claim, runId }: Claimed,
  overrides: Partial<PersistInput> = {},
): PersistInput => ({
  claim,
  runId,
  outcome: VALID,
  trace: TRACE,
  stateRules: [],
  now: NOW,
  log: () => undefined,
  ...overrides,
});

async function decidedDispute(
  customerId: string,
  options: {
    status?: string;
    type?: string;
    canary?: boolean;
    decidedAt?: Date;
  } = {},
): Promise<void> {
  const key = `d${++sequence}`;
  await insertCase(owner, `case_${key}`, customerId);
  await owner`
    insert into agent_runs (id, case_id, variant, model, prompt_version)
    values (${`run_${key}`}, ${`case_${key}`}, 'A', 'm', 'p')`;
  await owner`alter table proposed_actions disable trigger enforce_transition_role`;
  await owner`
    insert into proposed_actions (id, case_id, run_id, agent_type, agent_params, type, params, justification, status, decided_at, is_canary)
    values (${`act_${key}`}, ${`case_${key}`}, ${`run_${key}`}, 'open_dispute', '{}',
      ${options.type ?? 'open_dispute'}, '{}', 'x', ${options.status ?? 'approved'},
      ${options.decidedAt ?? new Date(NOW.getTime() - DAY_MS)}, ${options.canary ?? false})`;
  await owner`alter table proposed_actions enable trigger enforce_transition_role`;
}

const caseRow = async (id: string) => {
  const [row] = await owner`
    select status, category, flags, review_tier, claim_token, locked_until
    from cases where id = ${id}`;
  return row!;
};
const runRow = async (id: string) => {
  const [row] = await owner`
    select status, stop_reason, input_tokens, output_tokens, cached_input_tokens,
      cost_usd, latency_ms, finished_at
    from agent_runs where id = ${id}`;
  return row!;
};
const countOf = async (table: string, column: string, value: string) => {
  const [row] = await owner`
    select count(*)::int as n from ${owner(table)} where ${owner(column)} = ${value}`;
  return row!.n as number;
};

beforeAll(async () => {
  testDb = await startTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 2 });
  apiSql = postgres(testDb.urlFor('copilot_api'), { max: 4 });
  db = drizzle({ client: apiSql, schema });
}, CONTAINER_START_MS);

afterAll(async () => {
  await apiSql?.end();
  await owner?.end();
  await testDb?.stop();
});

describe('persistRun (01 §Agent pipeline, Persist)', () => {
  it('closes the run with its totals and latency, and writes its steps in order', async () => {
    const claimed = await claimedCase();
    expect(await persistRun(db, inputOf(claimed))).toMatchObject({
      runStatus: 'succeeded',
    });
    expect(await runRow(claimed.runId)).toEqual({
      status: 'succeeded',
      stop_reason: 'completed',
      input_tokens: 2_500,
      output_tokens: 600,
      cached_input_tokens: 600,
      cost_usd: '0.016600',
      latency_ms: NOW.getTime() - STARTED_AT.getTime(),
      finished_at: NOW,
    });
    const steps = await owner<{ idx: number; kind: string; name: string }[]>`
      select idx, kind, name, output_masked, latency_ms, provider_request_id
      from run_steps where run_id = ${claimed.runId} order by idx`;
    expect(steps.map(({ idx, kind, name }) => [idx, kind, name])).toEqual([
      [0, 'llm', 'claude-sonnet-5-5'],
      [1, 'tool', 'get_customer'],
      [2, 'llm', 'claude-sonnet-5-5'],
    ]);
    expect(steps[1]).toMatchObject({
      output_masked: { first_name: 'Ana' },
      latency_ms: 40,
      provider_request_id: null,
    });
  });

  it('stores the filled draft and proposes the agent action unchanged', async () => {
    const claimed = await claimedCase();
    const { actionId } = await persistRun(db, inputOf(claimed));
    const [resolution] = await owner`
      select category, draft_reply, abstained from resolutions where run_id = ${claimed.runId}`;
    expect(resolution!.category).toBe('unrecognized_card_charge');
    expect(resolution!.draft_reply).toMatch(/^Hola Ana, /);
    expect(resolution!.draft_reply).not.toMatch(/\{\{/);
    const [proposal] = await owner`
      select id, case_id, agent_type, agent_params, type, params, justification, status, is_canary, proposed_at
      from proposed_actions where run_id = ${claimed.runId}`;
    const action = resolutionOf().proposed_action;
    const params = {
      transaction_ids: action.transaction_ids,
      reason_code: action.reason_code,
    };
    expect(proposal).toEqual({
      id: actionId,
      case_id: claimed.claim.caseId,
      agent_type: action.type,
      agent_params: params,
      type: action.type,
      params,
      justification: action.justification,
      status: 'proposed',
      is_canary: false,
      proposed_at: NOW,
    });
  });

  it('names the agent version in an audit row for the proposal', async () => {
    const claimed = await claimedCase();
    const { actionId } = await persistRun(db, inputOf(claimed));
    const rows = await owner`
      select at, actor, event, detail_masked from audit_log where ref = ${actionId}`;
    expect(rows).toEqual([
      {
        at: NOW,
        actor: ACTOR,
        event: 'proposal.create',
        detail_masked: {
          run_id: claimed.runId,
          type: 'open_dispute',
          flags: [],
          review_tier: 'high',
        },
      },
    ]);
  });

  it('moves the case to needs_review with its category, flags and tier, and releases the claim', async () => {
    const claimed = await claimedCase();
    await persistRun(db, inputOf(claimed));
    expect(await caseRow(claimed.claim.caseId)).toEqual({
      status: 'needs_review',
      category: 'unrecognized_card_charge',
      flags: [],
      review_tier: 'high',
      claim_token: null,
      locked_until: null,
    });
  });

  it('writes no resolution on a fallback: none with its reason and no category', async () => {
    const claimed = await claimedCase();
    const persisted = await persistRun(
      db,
      inputOf(claimed, { outcome: BUDGET_STOP }),
    );
    expect(persisted.runStatus).toBe('fallback');
    expect(await runRow(claimed.runId)).toMatchObject({
      status: 'fallback',
      stop_reason: 'budget',
    });
    expect(await countOf('resolutions', 'run_id', claimed.runId)).toBe(0);
    const [proposal] = await owner`
      select type, justification from proposed_actions where run_id = ${claimed.runId}`;
    expect(proposal!.type).toBe('none');
    expect(proposal!.justification).toContain('budget');
    expect(await caseRow(claimed.claim.caseId)).toMatchObject({
      status: 'needs_review',
      category: null,
      flags: expect.arrayContaining(['fallback']) as unknown,
    });
  });

  it('ends a kill-switch run with no steps and zero totals', async () => {
    const claimed = await claimedCase();
    await persistRun(
      db,
      inputOf(claimed, { outcome: agentDisabled(false), trace: [] }),
    );
    expect(await runRow(claimed.runId)).toMatchObject({
      status: 'fallback',
      stop_reason: 'agent_disabled',
      input_tokens: 0,
      cost_usd: '0.000000',
    });
    expect(await countOf('run_steps', 'run_id', claimed.runId)).toBe(0);
    expect(await countOf('proposed_actions', 'run_id', claimed.runId)).toBe(1);
  });
});

describe('persistRun masking (02 G6)', () => {
  const PHONE = '5512345678';
  const EIGHT_DIGITS = /\d{8,}/;

  it('masks the steps again on write, whatever the caller passed', async () => {
    const claimed = await claimedCase();
    await persistRun(
      db,
      inputOf(claimed, {
        trace: [
          step({
            kind: 'guard',
            name: 'injection_scan',
            inputMasked: { text: `tel ${PHONE}` },
            outputMasked: { outcome: 'flagged', ref: PHONE },
          }),
        ],
      }),
    );
    const rows = await owner`
      select input_masked, output_masked from run_steps where run_id = ${claimed.runId}`;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(EIGHT_DIGITS);
  });

  it('masks the model text shown to ops: reasoning summary and justification', async () => {
    const claimed = await claimedCase();
    const resolution = resolutionOf({
      reasoning_summary: `La clienta dio el ${PHONE}.`,
      proposed_action: {
        ...resolutionOf().proposed_action,
        justification: `Contacto ${PHONE}; cargo con un factor.`,
      },
    });
    await persistRun(
      db,
      inputOf(claimed, {
        outcome: {
          kind: 'validated',
          validation: { ...VALID_RUN, resolution },
        },
      }),
    );
    const [stored] = await owner`
      select r.reasoning_summary, p.justification
      from resolutions r join proposed_actions p on p.run_id = r.run_id
      where r.run_id = ${claimed.runId}`;
    expect(stored).toBeDefined();
    expect(JSON.stringify(stored)).not.toMatch(EIGHT_DIGITS);
  });
});

describe('persistRun fencing (01 §Webhook and queue)', () => {
  async function expectNothingWritten(
    { claim, runId }: Claimed,
    runStatus = 'running',
  ) {
    expect(await runRow(runId)).toMatchObject({
      status: runStatus,
      finished_at: null,
    });
    expect(await countOf('run_steps', 'run_id', runId)).toBe(0);
    expect(await countOf('resolutions', 'run_id', runId)).toBe(0);
    expect(await countOf('proposed_actions', 'run_id', runId)).toBe(0);
    const [audit] = await owner`
      select count(*)::int as n from audit_log where detail_masked->>'run_id' = ${runId}`;
    expect(audit!.n).toBe(0);
    expect((await caseRow(claim.caseId)).status).toBe('investigating');
  }

  it('lets a stale claim write nothing once another attempt holds the case', async () => {
    const claimed = await claimedCase();
    await owner`
      update cases set claim_token = ${randomUUID()} where id = ${claimed.claim.caseId}`;
    await expect(persistRun(db, inputOf(claimed))).rejects.toBeInstanceOf(
      StaleClaimError,
    );
    await expectNothingWritten(claimed);
  });

  it('writes nothing for a run that is no longer running', async () => {
    const claimed = await claimedCase();
    await owner`update agent_runs set status = 'abandoned' where id = ${claimed.runId}`;
    await expect(persistRun(db, inputOf(claimed))).rejects.toBeInstanceOf(
      StaleClaimError,
    );
    await expectNothingWritten(claimed, 'abandoned');
  });

  it('writes all or nothing: a failing insert leaves no step, run end or case change', async () => {
    const claimed = await claimedCase();
    await owner`alter table proposed_actions disable trigger enforce_transition_role`;
    await owner`
      insert into agent_runs (id, case_id, variant, model, prompt_version)
      values (${`${claimed.runId}_old`}, ${claimed.claim.caseId}, 'A', 'm', 'p')`;
    await owner`
      insert into proposed_actions (id, case_id, run_id, agent_type, agent_params, type, params, justification)
      values (${`act_${claimed.runId}_old`}, ${claimed.claim.caseId}, ${`${claimed.runId}_old`}, 'none', '{}', 'none', '{}', 'x')`;
    await owner`alter table proposed_actions enable trigger enforce_transition_role`;
    await expect(persistRun(db, inputOf(claimed))).rejects.toThrow();
    await expectNothingWritten(claimed);
  });
});

describe('persistRun first_party_signal count (02 G3)', () => {
  const flagsFor = async (customerId: string) => {
    const claimed = await claimedCase(customerId);
    await persistRun(db, inputOf(claimed));
    return (await caseRow(claimed.claim.caseId)).flags as string[];
  };

  it('raises the flag at three approved or executed disputes in the lookback', async () => {
    const customer = 'cus_fp_three';
    await decidedDispute(customer);
    await decidedDispute(customer, { status: 'executed' });
    expect(await flagsFor(customer)).not.toContain('first_party_signal');
    await decidedDispute(customer, {
      decidedAt: new Date(NOW.getTime() - LOOKBACK_MS + 60_000),
    });
    expect(await flagsFor(customer)).toContain('first_party_signal');
  });

  it.each([
    ['a canary', { canary: true }],
    ['a rejected dispute', { status: 'rejected' }],
    ['another action type', { type: 'resend_cep' }],
    [
      'a dispute decided before the lookback',
      {
        decidedAt: new Date(NOW.getTime() - LOOKBACK_MS - 60_000),
      },
    ],
  ])('does not count %s', async (_, excluded) => {
    const customer = `cus_fp_${++sequence}`;
    await decidedDispute(customer);
    await decidedDispute(customer);
    await decidedDispute(customer, excluded);
    expect(await flagsFor(customer)).not.toContain('first_party_signal');
  });

  it("does not count another customer's disputes", async () => {
    const customer = `cus_fp_${++sequence}`;
    await decidedDispute(customer);
    await decidedDispute(customer);
    await decidedDispute(`${customer}_other`);
    expect(await flagsFor(customer)).not.toContain('first_party_signal');
  });
});
