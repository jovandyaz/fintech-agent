import {
  ACTION_STATUSES,
  DB_ROLES,
  type ActionStatus,
  type DbRole,
} from '@fintech-agent/contracts';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setRolePasswords } from '../src/database/roles.js';
import {
  CONTAINER_START_MS,
  insertCase,
  startTestDatabase,
  type TestDatabase,
} from './database.js';

const OK = 'ok';
const PERMISSION_DENIED = '42501';
const TRANSITION_REFUSED = 'P0001';
const FOREIGN_KEY_VIOLATION = '23503';

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
    await insertCase(owner, id);
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

  denied.push(
    [
      'copilot_api approves without recording who decided',
      'copilot_api',
      (s) =>
        s`update proposed_actions set status = 'approved', final_reply = 'listo' where id = 'act_real'`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_api approves without a final reply',
      'copilot_api',
      (s) =>
        s`update proposed_actions set status = 'approved', decided_by = 'operator:ana', decided_at = now() where id = 'act_real'`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_api rejects without a reject code',
      'copilot_api',
      (s) =>
        s`update proposed_actions set status = 'rejected', decided_by = 'operator:ana', decided_at = now(), final_reply = 'listo' where id = 'act_real'`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_api changes the action without marking an override',
      'copilot_api',
      (s) =>
        s`update proposed_actions set status = 'approved', decided_by = 'operator:ana', decided_at = now(), final_reply = 'listo',
            type = 'escalate_fraud' where id = 'act_real'`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_api marks an override that changes nothing',
      'copilot_api',
      (s) =>
        s`update proposed_actions set status = 'approved', decided_by = 'operator:ana', decided_at = now(), final_reply = 'listo',
            operator_override = true where id = 'act_real'`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_api supersedes a proposal while recording a decision',
      'copilot_api',
      (s) =>
        s`update proposed_actions set status = 'superseded', decided_by = 'operator:ana', decided_at = now(), final_reply = 'listo'
            where id = 'act_real'`,
      TRANSITION_REFUSED,
    ],
    [
      'copilot_api supersedes a proposal while overriding its action',
      'copilot_api',
      (s) =>
        s`update proposed_actions set status = 'superseded', type = 'escalate_fraud', operator_override = true
            where id = 'act_real'`,
      TRANSITION_REFUSED,
    ],
    ...(
      [
        ['webhook_events', 'payload_hash'],
        ['resolutions', 'draft_reply'],
        ['run_steps', 'name'],
      ] as const
    ).map(([table, column]): [string, DbRole, Query, string] => [
      `copilot_api updates the append-only ${table}`,
      'copilot_api',
      (s) => s`update ${s(table)} set ${s(column)} = ${s(column)}`,
      PERMISSION_DENIED,
    ]),
  );

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
        s`update proposed_actions set status = 'approved', decided_by = 'operator:ana', decided_at = now(), final_reply = 'listo' where id = 'act_real'`,
    ],
    [
      'copilot_api marks a missed canary',
      'copilot_api',
      (s) =>
        s`update proposed_actions set status = 'canary_missed', decided_by = 'operator:ana', decided_at = now(), final_reply = 'listo' where id = 'act_canary'`,
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

  it('approves an override that records it', async () => {
    await resetProposals();
    expect(
      await outcome(
        as(
          'copilot_api',
        )`update proposed_actions set status = 'approved', decided_by = 'operator:ana', decided_at = now(),
          final_reply = 'listo', type = 'escalate_fraud', operator_override = true where id = 'act_real'`,
      ),
    ).toBe(OK);
  });

  it('grants copilot_mcp INSERT on security_events and nothing else', async () => {
    const tables = await owner<
      { table_name: string; privilege_type: string }[]
    >`
      select table_name, privilege_type from information_schema.role_table_grants
      where grantee = 'copilot_mcp' order by table_name, privilege_type`;
    const columns = await owner<{ table_name: string }[]>`
      select distinct table_name from information_schema.column_privileges
      where grantee = 'copilot_mcp' and privilege_type <> 'INSERT'`;
    expect(tables).toEqual([
      { table_name: 'security_events', privilege_type: 'INSERT' },
    ]);
    expect(columns).toEqual([]);
  });

  it('sets a password with quotes and percent signs verbatim, and again', async () => {
    const password = `it's 100% "quoted"`;
    const passwords = {
      copilot_api: password,
      copilot_executor: db.passwordFor('copilot_executor'),
      copilot_mcp: db.passwordFor('copilot_mcp'),
    };
    let sql: postgres.Sql | undefined;
    try {
      await setRolePasswords(db.ownerUrl, passwords);
      await setRolePasswords(db.ownerUrl, passwords);
      const url = new URL(db.urlFor('copilot_api'));
      url.password = encodeURIComponent(password);
      sql = postgres(url.toString(), { max: 1 });
      expect(await outcome(sql`select 1`)).toBe(OK);
    } finally {
      await sql?.end();
      await setRolePasswords(db.ownerUrl, {
        ...passwords,
        copilot_api: db.passwordFor('copilot_api'),
      });
    }
  });
});

describe('webhook intake order (01 Webhook and queue)', () => {
  const intake = (sql: postgres.Sql, eventId: string, caseId: string) =>
    sql.begin(async (tx) => {
      const recorded = await tx`
        insert into webhook_events (event_id, payload_hash, case_id)
        values (${eventId}, 'hash', ${caseId})
        on conflict (event_id) do nothing
        returning event_id`;
      if (recorded.length === 0) return false;
      await tx`
        insert into cases (id, ticket_id, folio, received_at, source, customer_id, text_masked)
        values (${caseId}, ${`T-${caseId}`}, 'AC-WHKA-0001', now(), 'webhook', 'cus_01', 'hola')`;
      return true;
    });

  it('records the event before its case in one transaction, as copilot_api', async () => {
    const api = as('copilot_api');
    expect(await intake(api, 'evt_w1', 'case_w1')).toBe(true);
    expect(await intake(api, 'evt_w1', 'case_w1')).toBe(false);
    const [row] = await owner<{ count: string }[]>`
      select count(*) from cases where id = 'case_w1'`;
    expect(row?.count).toBe('1');
  });

  it('refuses to commit an event whose case was never inserted', async () => {
    const api = as('copilot_api');
    expect(
      await outcome(
        api.begin(
          (tx) => tx`
            insert into webhook_events (event_id, payload_hash, case_id)
            values ('evt_w2', 'hash', 'case_missing')`,
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
    const [row] = await owner<{ count: string }[]>`
      select count(*) from webhook_events where event_id = 'evt_w2'`;
    expect(row?.count).toBe('0');
  });
});

describe('transition matrix (02 G1, G3)', () => {
  const DECISIONS = new Set<ActionStatus>([
    'approved',
    'rejected',
    'canary_caught',
    'canary_missed',
  ]);
  const REJECTIONS = new Set<ActionStatus>(['rejected', 'canary_caught']);
  const allowed = (
    role: DbRole,
    from: ActionStatus,
    to: ActionStatus,
    canary: boolean,
  ): boolean =>
    (role === 'copilot_api' &&
      from === 'proposed' &&
      (canary
        ? ['canary_caught', 'canary_missed', 'superseded'].includes(to)
        : ['approved', 'rejected', 'superseded'].includes(to))) ||
    (role === 'copilot_executor' &&
      from === 'approved' &&
      !canary &&
      ['executed', 'failed'].includes(to));

  const cases = (['copilot_api', 'copilot_executor'] as const).flatMap((role) =>
    ACTION_STATUSES.flatMap((from) =>
      ACTION_STATUSES.filter((to) => to !== from).flatMap((to) =>
        [false, true].map((canary) => ({ role, from, to, canary })),
      ),
    ),
  );

  beforeAll(async () => {
    await insertCase(owner, 'case_mx');
  });

  it.each(cases)(
    '$role moves $from → $to (canary: $canary)',
    async ({ role, from, to, canary }) => {
      await owner`alter table proposed_actions disable trigger enforce_transition_role`;
      await owner`delete from action_executions`;
      await owner`delete from proposed_actions`;
      await owner`
        insert into proposed_actions (id, case_id, run_id, agent_type, agent_params, type, params, justification, status, is_canary)
        values ('act_mx', 'case_mx', 'run_r1', 'none', '{}', 'none', '{}', 'x', ${from}, ${canary})`;
      await owner`alter table proposed_actions enable trigger enforce_transition_role`;
      const sql = as(role);
      const update =
        role === 'copilot_executor'
          ? sql`update proposed_actions set status = ${to} where id = 'act_mx'`
          : sql`update proposed_actions set status = ${to},
              decided_by = ${DECISIONS.has(to) ? 'operator:ana' : null},
              decided_at = ${DECISIONS.has(to) ? new Date() : null},
              final_reply = ${DECISIONS.has(to) ? 'listo' : null},
              reject_code = ${REJECTIONS.has(to) ? 'other' : null}
            where id = 'act_mx'`;
      expect((await outcome(update)) === OK).toBe(
        allowed(role, from, to, canary),
      );
    },
  );
});
