import { DB_ROLES, type DbRole } from '@fintech-agent/contracts';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setRolePasswords } from '../src/database/roles.js';
import { startTestDatabase, type TestDatabase } from './database.js';

const CONTAINER_START_MS = 120_000;
const OK = 'ok';
const PERMISSION_DENIED = '42501';
const TRANSITION_REFUSED = 'P0001';

type Query = (sql: postgres.Sql) => Promise<unknown>;

let db: TestDatabase;
let owner: postgres.Sql;
const connections = new Map<DbRole, postgres.Sql>();

const as = (role: DbRole): postgres.Sql => {
  const existing = connections.get(role);
  if (existing) return existing;
  const sql = postgres(db.urlFor(role), { max: 1, onnotice: () => undefined });
  connections.set(role, sql);
  return sql;
};

async function outcome(query: Promise<unknown>): Promise<string> {
  try {
    await query;
    return OK;
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

async function resetProposals(): Promise<void> {
  await owner`alter table proposed_actions disable trigger enforce_transition_role`;
  await owner`delete from action_executions`;
  await owner`delete from proposed_actions`;
  await owner`
    insert into proposed_actions (id, case_id, run_id, agent_type, agent_params, type, params, justification, status, is_canary)
    values ('act_real', 'case_r1', 'run_r1', 'none', '{}', 'none', '{}', 'x', 'proposed', false),
           ('act_canary', 'case_r2', 'run_r1', 'none', '{}', 'none', '{}', 'x', 'proposed', true),
           ('act_appr', 'case_r3', 'run_r1', 'none', '{}', 'none', '{}', 'x', 'approved', false),
           ('act_canappr', 'case_r4', 'run_r1', 'none', '{}', 'none', '{}', 'x', 'approved', true),
           ('act_done', 'case_r5', 'run_r1', 'none', '{}', 'none', '{}', 'x', 'executed', false)`;
  await owner`alter table proposed_actions enable trigger enforce_transition_role`;
  await owner`alter table action_executions disable trigger enforce_execution_of_approved`;
  await owner`insert into action_executions (action_id, status) values ('act_done', 'executed')`;
  await owner`alter table action_executions enable trigger enforce_execution_of_approved`;
}

beforeAll(async () => {
  db = await startTestDatabase();
  owner = postgres(db.ownerUrl, { max: 1, onnotice: () => undefined });
  for (const id of [
    'case_r1',
    'case_r2',
    'case_r3',
    'case_r4',
    'case_r5',
    'case_r6',
  ]) {
    await owner`
      insert into cases (id, ticket_id, folio, received_at, source, customer_id, text_masked)
      values (${id}, ${`T-${id}`}, ${`AC-KMQX-${id.slice(-2).toUpperCase()}AB`}, now(), 'webhook', 'cus_01', 'hola')`;
  }
  await owner`
    insert into agent_runs (id, case_id, variant, model, prompt_version)
    values ('run_r1', 'case_r1', 'a', 'model', 'v1')`;
}, CONTAINER_START_MS);

afterAll(async () => {
  await Promise.all([...connections.values()].map((sql) => sql.end()));
  await owner.end();
  await db.stop();
});

describe('database roles (02 G1)', () => {
  const denied: [string, DbRole, Query, string][] = [
    ...[
      'approved',
      'executed',
      'failed',
      'rejected',
      'canary_caught',
      'canary_missed',
      'superseded',
    ].map((status): [string, DbRole, Query, string] => [
      `copilot_api inserts a proposal already ${status}`,
      'copilot_api',
      (s) =>
        s`insert into proposed_actions (id, case_id, run_id, agent_type, agent_params, type, params, justification, status)
            values ('act_new', 'case_r6', 'run_r1', 'none', '{}', 'none', '{}', 'x', ${status})`,
      TRANSITION_REFUSED,
    ]),
    [
      'copilot_api inserts an approved canary',
      'copilot_api',
      (s) =>
        s`insert into proposed_actions (id, case_id, run_id, agent_type, agent_params, type, params, justification, status, is_canary)
          values ('act_new', 'case_r6', 'run_r1', 'none', '{}', 'none', '{}', 'x', 'approved', true)`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_api inserts a proposal that is already decided',
      'copilot_api',
      (s) =>
        s`insert into proposed_actions (id, case_id, run_id, agent_type, agent_params, type, params, justification, decided_by)
          values ('act_new', 'case_r6', 'run_r1', 'none', '{}', 'none', '{}', 'x', 'operator:ana')`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_api inserts a proposal whose executable action differs from the agent’s',
      'copilot_api',
      (s) =>
        s`insert into proposed_actions (id, case_id, run_id, agent_type, agent_params, type, params, justification)
          values ('act_new', 'case_r6', 'run_r1', 'none', '{}', 'escalate_fraud', '{}', 'x')`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_api edits a proposal without deciding it',
      'copilot_api',
      (s) =>
        s`update proposed_actions set params = '{"transaction_ids":["tx_x"]}' where id = 'act_real'`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_api swaps the action of an approved row',
      'copilot_api',
      (s) =>
        s`update proposed_actions set type = 'escalate_fraud', params = '{"t":2}' where id = 'act_appr'`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_api rewrites who decided an executed row',
      'copilot_api',
      (s) =>
        s`update proposed_actions set decided_by = 'operator:bob' where id = 'act_done'`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_executor executes an approved canary',
      'copilot_executor',
      (s) =>
        s`update proposed_actions set status = 'executed' where id = 'act_canappr'`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_executor records an execution for an undecided proposal',
      'copilot_executor',
      (s) =>
        s`insert into action_executions (action_id, status) values ('act_real', 'started')`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_executor shadows proposed_actions with a temp table to execute a canary',
      'copilot_executor',
      (s) =>
        s.begin(async (tx) => {
          await tx`create temp table proposed_actions (id text, status text, is_canary boolean) on commit drop`;
          await tx`insert into pg_temp.proposed_actions values ('act_canappr', 'approved', false)`;
          await tx`insert into public.action_executions (action_id, status) values ('act_canappr', 'started')`;
        }),
      TRANSITION_REFUSED,
    ],
    [
      'copilot_executor moves an execution onto another action',
      'copilot_executor',
      (s) =>
        s`update action_executions set action_id = 'act_canappr' where action_id = 'act_done'`,
      PERMISSION_DENIED,
    ],
    [
      'copilot_executor records an execution for an approved canary',
      'copilot_executor',
      (s) =>
        s`insert into action_executions (action_id, status) values ('act_canappr', 'started')`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_api inserts into action_executions',
      'copilot_api',
      (s) =>
        s`insert into action_executions (action_id, status) values ('act_appr', 'started')`,
      PERMISSION_DENIED,
    ],
    [
      'copilot_api marks an approved action executed',
      'copilot_api',
      (s) =>
        s`update proposed_actions set status = 'executed' where id = 'act_appr'`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_api approves a canary',
      'copilot_api',
      (s) =>
        s`update proposed_actions set status = 'approved' where id = 'act_canary'`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_api rejects a canary instead of catching it',
      'copilot_api',
      (s) =>
        s`update proposed_actions set status = 'rejected' where id = 'act_canary'`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_api moves a real proposal to canary_caught',
      'copilot_api',
      (s) =>
        s`update proposed_actions set status = 'canary_caught' where id = 'act_real'`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_api clears is_canary',
      'copilot_api',
      (s) =>
        s`update proposed_actions set is_canary = false where id = 'act_canary'`,
      PERMISSION_DENIED,
    ],
    [
      'copilot_api rewrites the agent proposal',
      'copilot_api',
      (s) =>
        s`update proposed_actions set agent_params = '{"x":1}' where id = 'act_real'`,
      PERMISSION_DENIED,
    ],
    [
      'copilot_executor approves a proposal',
      'copilot_executor',
      (s) =>
        s`update proposed_actions set status = 'approved' where id = 'act_real'`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_executor rewrites the executable params',
      'copilot_executor',
      (s) =>
        s`update proposed_actions set params = '{"x":1}' where id = 'act_appr'`,
      PERMISSION_DENIED,
    ],
    [
      'copilot_mcp reads security_events',
      'copilot_mcp',
      (s) => s`select * from security_events`,
      PERMISSION_DENIED,
    ],
    [
      'copilot_mcp inserts a case',
      'copilot_mcp',
      (s) =>
        s`insert into cases (id, ticket_id, folio, received_at, source, customer_id, text_masked)
          values ('case_x', 'T-x', 'AC-AAAA-BBBB', now(), 'webhook', 'cus_01', 'x')`,
      PERMISSION_DENIED,
    ],
    ...DB_ROLES.flatMap((role): [string, DbRole, Query, string][] => [
      [
        `${role} updates audit_log`,
        role,
        (s) => s`update audit_log set actor = 'x'`,
        PERMISSION_DENIED,
      ],
      [
        `${role} deletes from audit_log`,
        role,
        (s) => s`delete from audit_log`,
        PERMISSION_DENIED,
      ],
      [
        `${role} updates security_events`,
        role,
        (s) => s`update security_events set ref_masked = 'x'`,
        PERMISSION_DENIED,
      ],
      [
        `${role} deletes from security_events`,
        role,
        (s) => s`delete from security_events`,
        PERMISSION_DENIED,
      ],
    ]),
  ];

  it.each(denied)('refuses: %s', async (_, role, query, expected) => {
    await resetProposals();
    expect(await outcome(query(as(role)))).toBe(expected);
  });

  const allowed: [string, DbRole, Query][] = [
    [
      'copilot_api reads action_executions',
      'copilot_api',
      (s) => s`select count(*) from action_executions`,
    ],
    [
      'copilot_api approves a real proposal',
      'copilot_api',
      (s) =>
        s`update proposed_actions set status = 'approved', decided_by = 'operator:ana' where id = 'act_real'`,
    ],
    [
      'copilot_api marks a missed canary',
      'copilot_api',
      (s) =>
        s`update proposed_actions set status = 'canary_missed' where id = 'act_canary'`,
    ],
    [
      'copilot_api writes an audit row',
      'copilot_api',
      (s) =>
        s`insert into audit_log (actor, event, ref) values ('operator:ana', 'approve', 'act_real')`,
    ],
    [
      'copilot_executor marks an approved action executed',
      'copilot_executor',
      (s) =>
        s`update proposed_actions set status = 'executed' where id = 'act_appr'`,
    ],
    [
      'copilot_executor marks an approved action failed',
      'copilot_executor',
      (s) =>
        s`update proposed_actions set status = 'failed' where id = 'act_appr'`,
    ],
    [
      'copilot_api inserts a canary proposal',
      'copilot_api',
      (s) =>
        s`insert into proposed_actions (id, case_id, run_id, agent_type, agent_params, type, params, justification, is_canary)
          values ('act_new', 'case_r6', 'run_r1', 'none', '{}', 'none', '{}', 'x', true)`,
    ],
    [
      'copilot_executor records an execution',
      'copilot_executor',
      (s) =>
        s`insert into action_executions (action_id, status) values ('act_appr', 'started')`,
    ],
    [
      'copilot_mcp records a security event',
      'copilot_mcp',
      (s) =>
        s`insert into security_events (kind, case_id, run_id, ref_masked) values ('cross_customer_lookup', 'case_r1', 'run_r1', 'tx_f002')`,
    ],
  ];

  it.each(allowed)('allows: %s', async (_, role, query) => {
    await resetProposals();
    expect(await outcome(query(as(role)))).toBe(OK);
  });

  it('sets a password with quotes and percent signs verbatim, and again', async () => {
    const password = `it's 100% "quoted"`;
    const passwords = {
      copilot_api: password,
      copilot_executor: db.passwordFor('copilot_executor'),
      copilot_mcp: db.passwordFor('copilot_mcp'),
    };
    await setRolePasswords(db.ownerUrl, passwords);
    await setRolePasswords(db.ownerUrl, passwords);
    const url = new URL(db.urlFor('copilot_api'));
    url.password = encodeURIComponent(password);
    const sql = postgres(url.toString(), { max: 1 });
    expect(await outcome(sql`select 1`)).toBe(OK);
    await sql.end();
    await setRolePasswords(db.ownerUrl, {
      ...passwords,
      copilot_api: db.passwordFor('copilot_api'),
    });
  });
});
