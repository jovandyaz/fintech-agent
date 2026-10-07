# Step 4a — Database foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Postgres schema for every 01 table, the three roles with their grants and the `enforce_transition_role` trigger, a one-shot `seed` service, the MCP server's Postgres security-event sink, the masking JSON logger, and a minimal `api` that refuses to boot with the executor key.

**Architecture:** `apps/api` owns the Drizzle schema and migrations (`apps/api/drizzle/`). Migrations run as the owner role from `seed`, which then gives each role a password from env. Each service connects with its own role URL. Integration tests start Postgres 16 with Testcontainers through one helper that `apps/mcp` reuses as a dev dependency.

**Tech Stack:** NestJS 11.2, drizzle-orm 0.45 + drizzle-kit 0.31 (postgres-js 3.4), @testcontainers/postgresql 12.2, yaml, vitest 5, Node 24, tsx.

**Spec:** specs/01-architecture.md (Data model, Components), specs/02-security.md (G1, G4, G6, Required tests: Process boundary, Tool binding, Masking at sinks for the logger), specs/04-build-plan.md §Step 4. Step 4 is split into 4a foundation, 4b gate, 4c executor, 4d validator, 4e agent loop; 4a is first because all others write to these tables.

## Global Constraints

- Node 24 via `fnm exec --using=24 --`; pnpm only; versions pinned in package.json.
- Commits: one line, Conventional Commits, English, imperative, ≤72 chars, no trailers. Ports: `feat(port): … from knowtis` with their tests.
- TDD: each behavior test fails first for the right reason. Commit only when `pnpm verify` exits 0; integration specs (`*.int.spec.ts`) run with `pnpm vitest run --project integration` and must pass before their commit.
- No secret literal in code; every new variable in `.env.example` with a dev default.
- Closed sets are `as const` arrays in `packages/contracts`; Postgres enums are derived from them.
- Zero comments by default; WHY-only; JSDoc on exports.
- 02 G1: three roles `copilot_api`, `copilot_executor`, `copilot_mcp`; no role has UPDATE or DELETE on `audit_log` or `security_events`; `copilot_mcp` can only INSERT into `security_events`; `copilot_api` can SELECT but not write `action_executions`.
- 02 G1 trigger: `proposed → approved | rejected | canary_caught | canary_missed | superseded` only for `copilot_api`; `approved → executed | failed` only for `copilot_executor`; `proposed → approved` refused when `is_canary`.
- 02 G6: logs pass `maskPii`/`maskJson`; `authorization`, operator tokens and case tokens are redacted.

## Review Focus

1. `is_canary` flipped to false by `copilot_api` before approving → must be refused (column grant and trigger), else a canary reaches the executor.
2. A non-canary row moved to `canary_caught`/`canary_missed`, or a canary moved to `approved`/`rejected` → refused by the trigger (canaries end only in canary states).
3. `copilot_api` rewriting `agent_type`/`agent_params` after the proposal → refused by column grants ("agent_* never change", 01).
4. Running `seed` twice (compose restart) → migrations and role setup are idempotent, passwords re-applied, no error.
5. A role password containing a quote or `%` → applied verbatim through `format('%L')`, never interpolated into SQL text.

---

### Task 1: Closed sets for persisted states

**Files:**

- Create: `packages/contracts/src/states.ts`
- Modify: `packages/contracts/src/index.ts`, `apps/mcp/src/security-events.ts` (import `SECURITY_EVENT_KINDS` from contracts, drop the local copy)
- Test: `packages/contracts/src/states.spec.ts`

**Interfaces:**

- Produces: `CASE_STATUSES`, `CASE_SOURCES`, `REVIEW_TIERS`, `RUN_STATUSES`, `STOP_REASONS`, `STEP_KINDS`, `ACTION_STATUSES`, `EXECUTION_STATUSES`, `SECURITY_EVENT_KINDS`, `DB_ROLES` with their union types `CaseStatus`, … , `DbRole`.

- [ ] **Step 1: failing test** — `states.spec.ts` asserts the exact members from 01 (catches drift from the spec):

```ts
import { describe, expect, it } from 'vitest';
import {
  ACTION_STATUSES,
  CASE_STATUSES,
  DB_ROLES,
  EXECUTION_STATUSES,
  RUN_STATUSES,
  STEP_KINDS,
  STOP_REASONS,
} from './states.js';

describe('persisted state sets (01 Data model)', () => {
  it('match the spec', () => {
    expect(CASE_STATUSES).toEqual([
      'queued',
      'investigating',
      'needs_review',
      'resolved',
      'failed',
    ]);
    expect(RUN_STATUSES).toEqual([
      'running',
      'succeeded',
      'fallback',
      'failed',
      'abandoned',
    ]);
    expect(STOP_REASONS).toEqual([
      'completed',
      'budget',
      'validation',
      'agent_disabled',
      'error',
    ]);
    expect(STEP_KINDS).toEqual([
      'llm',
      'tool',
      'retrieval',
      'guard',
      'validation',
    ]);
    expect(ACTION_STATUSES).toEqual([
      'proposed',
      'approved',
      'executed',
      'rejected',
      'failed',
      'superseded',
      'canary_caught',
      'canary_missed',
    ]);
    expect(EXECUTION_STATUSES).toEqual(['started', 'executed', 'failed']);
    expect(DB_ROLES).toEqual([
      'copilot_api',
      'copilot_executor',
      'copilot_mcp',
    ]);
  });
});
```

- [ ] **Step 2:** run `fnm exec --using=24 -- pnpm vitest run packages/contracts/src/states.spec.ts` → FAIL (module missing).
- [ ] **Step 3:** write `states.ts` with those arrays plus `CASE_SOURCES = ['webhook','console','eval']`, `REVIEW_TIERS = ['standard','high']`, `SECURITY_EVENT_KINDS = ['cross_customer_lookup']`, each with `(typeof X)[number]` type and a one-line JSDoc; export from index; switch `apps/mcp/src/security-events.ts` to the contracts export.
- [ ] **Step 4:** run the test → PASS; `pnpm verify` → 0.
- [ ] **Step 5:** commit `feat(contracts): add closed sets for persisted states`.

### Task 2: `apps/api` package, Drizzle schema and migrations (ports the Drizzle module and migrate CLI)

**Files:**

- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/drizzle.config.ts`, `apps/api/src/database/schema.ts`, `apps/api/src/database/migrate.ts`, `apps/api/src/database/database.module.ts`, `apps/api/src/database/index.ts`, `apps/api/drizzle/*` (generated), `apps/api/test/database.ts`
- Test: `apps/api/src/database/migrate.int.spec.ts`

**Interfaces:**

- Produces: `schema` tables `webhookEvents, cases, agentRuns, runSteps, resolutions, proposedActions, actionExecutions, auditLog, securityEvents, policyChunks`; `migrateDatabase(url: string): Promise<void>`; `DATABASE_CONNECTION`, `DATABASE_CLIENT`, `type Database`; test helper `startTestDatabase(): Promise<TestDatabase>` with `{ ownerUrl: string; urlFor(role: DbRole): string; stop(): Promise<void> }` (exported as `@fintech-agent/api/test-database`).

- [ ] **Step 1: package** — `apps/api/package.json`: name `@fintech-agent/api`, `type: module`, exports `{"./test-database": "./test/database.ts"}`, scripts `typecheck`, `db:generate` (`drizzle-kit generate`); deps `@fintech-agent/contracts`, `drizzle-orm@0.45.3`, `postgres@3.4.9`, `@nestjs/common@11.2.x`, `@nestjs/core@11.2.x`, `@nestjs/platform-express@11.2.x`, `reflect-metadata`, `tsx`, `zod`; devDeps `drizzle-kit@0.31.11`, `@testcontainers/postgresql@12.2.0`, `yaml`. tsconfig extends base with `experimentalDecorators: true` and no `emitDecoratorMetadata` (Ruling: explicit `@Inject` everywhere). Install with `fnm exec --using=24 -- pnpm install`.
- [ ] **Step 2: failing test** — `migrate.int.spec.ts`:

```ts
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDatabase } from './migrate.js';
import { startTestDatabase, type TestDatabase } from '../../test/database.js';

const TABLES = [
  'action_executions',
  'agent_runs',
  'audit_log',
  'cases',
  'policy_chunks',
  'proposed_actions',
  'resolutions',
  'run_steps',
  'security_events',
  'webhook_events',
];
let db: TestDatabase;
beforeAll(async () => {
  db = await startTestDatabase();
}, 120_000);
afterAll(() => db.stop());

describe('migrations (01 Data model)', () => {
  it('create every 01 table and can run again', async () => {
    await migrateDatabase(db.ownerUrl);
    const sql = postgres(db.ownerUrl, { max: 1 });
    const rows = await sql<
      { table_name: string }[]
    >`select table_name from information_schema.tables where table_schema = 'public' order by table_name`;
    expect(rows.map((r) => r.table_name)).toEqual(TABLES);
    await sql.end();
  });

  it('stems and unaccents policy text so devolucion finds devolución', async () => {
    const sql = postgres(db.ownerUrl, { max: 1 });
    const [row] = await sql<
      { hit: boolean }[]
    >`select to_tsvector('es_unaccent', 'devolución') @@ to_tsquery('es_unaccent', 'devolucion') as hit`;
    expect(row?.hit).toBe(true);
    await sql.end();
  });
});
```

- [ ] **Step 3:** run `fnm exec --using=24 -- pnpm vitest run --project integration apps/api` → FAIL (modules missing).
- [ ] **Step 4: schema** — `schema.ts` with `pgEnum`s from the contracts sets (`case_status`, `case_source`, `review_tier`, `case_category` from `CASE_CATEGORIES`, `run_status`, `stop_reason`, `step_kind`, `action_type` from `ACTION_TYPES`, `action_status`, `execution_status`, `reject_code` from `REJECT_CODES`, `security_event_kind`) and the ten tables exactly as 01 lists them: text ids for registry ids; `uuid().defaultRandom()` ids for `audit_log` and `security_events`; `timestamptz` (`timestamp({ withTimezone: true })`) times; `flags`, `citations`, `agent_params`, `params`, `acknowledged_flags`, `reviewed_transaction_ids`, `state_rules`, `input_masked`, `output_masked`, `result`, `detail_masked` as `jsonb`; `cost_usd` as `numeric(12, 6)`; FKs to `cases`/`agent_runs`/`proposed_actions`; `run_steps` PK `(run_id, idx)`; `cases` index on `(status, next_attempt_at)`; a partial unique index `one_open_proposal_per_case` on `proposed_actions(case_id) where status = 'proposed'`; `policy_chunks.tsv` generated `setweight(to_tsvector('es_unaccent', section),'A') || setweight(to_tsvector('es_unaccent', keywords),'B') || setweight(to_tsvector('es_unaccent', content),'D')` with a GIN index.
- [ ] **Step 5: migrations** — in order: `pnpm --filter @fintech-agent/api exec drizzle-kit generate --custom --name=search-config` and fill it with `CREATE EXTENSION IF NOT EXISTS unaccent;` + `CREATE TEXT SEARCH CONFIGURATION es_unaccent (COPY = spanish); ALTER TEXT SEARCH CONFIGURATION es_unaccent ALTER MAPPING FOR hword, hword_part, word WITH unaccent, spanish_stem;` guarded by `IF NOT EXISTS` via a `DO` block; then `drizzle-kit generate --name=tables`.
- [ ] **Step 6: migrate + module (port)** — `migrate.ts`: port `knowtis/apps/api/src/database/migrate.ts` trimmed per 00 (no advisory lock, no lock retry, no dotenv, no notice formatter): `export async function migrateDatabase(url)` opening `postgres(url, { max: 1, onnotice: () => undefined })`, `migrate(drizzle(client), { migrationsFolder })` with the folder resolved from `import.meta.dirname`, `finally client.end()`. `database.module.ts`: port Knowtis' module trimmed (no `ConfigService`; reads `API_DATABASE_URL` through an injected config token; no notice logger). `test/database.ts`: `PostgreSqlContainer('postgres:16-alpine')`, returns owner URL from `getConnectionUri()` and `urlFor(role)` built from it with the role name and the password `test-<role>`; `stop()`.
- [ ] **Step 7:** run the integration test → PASS; `pnpm verify` → 0.
- [ ] **Step 8:** commit `feat(port): bring the drizzle module and migrate cli from knowtis`, then a separate `feat(api): add the 01 schema and its migrations` if the schema is committed apart from the port (port first).

### Task 3: Roles, grants and the transition trigger (02 G1)

**Files:**

- Create: `apps/api/drizzle/<n>_roles.sql` (custom migration), `apps/api/src/database/roles.ts`
- Modify: `apps/api/test/database.ts` (call `migrateDatabase` + `setRolePasswords` in `startTestDatabase`)
- Test: `apps/api/test/roles.int.spec.ts`

**Interfaces:**

- Consumes: Task 2 schema, `DB_ROLES`.
- Produces: `setRolePasswords(ownerUrl: string, passwords: Record<DbRole, string>): Promise<void>`.

- [ ] **Step 1: failing tests** — `roles.int.spec.ts` (rows fixed as owner first: one case `case_t1`, one run `run_t1`, a non-canary `act_real` and a canary `act_canary`, both `proposed`, and an `approved` `act_appr`). Each `as(role)` opens `postgres(db.urlFor(role), { max: 1 })`. Helper `code(promise)` resolves to the error's `code` (or `'ok'`):

```ts
it.each([
  ['copilot_api inserts action_executions', 'copilot_api', (s) => s`insert into action_executions (action_id, status) values ('act_appr', 'started')`, '42501'],
  ['copilot_api reads action_executions', 'copilot_api', (s) => s`select count(*) from action_executions`, 'ok'],
  ['copilot_api marks approved → executed', 'copilot_api', (s) => s`update proposed_actions set status = 'executed' where id = 'act_appr'`, 'P0001'],
  ['copilot_api approves a canary', 'copilot_api', (s) => s`update proposed_actions set status = 'approved' where id = 'act_canary'`, 'P0001'],
  ['copilot_api clears is_canary', 'copilot_api', (s) => s`update proposed_actions set is_canary = false where id = 'act_canary'`, '42501'],
  ['copilot_api rewrites agent_params', 'copilot_api', (s) => s`update proposed_actions set agent_params = '{}' where id = 'act_real'`, '42501'],
  ['copilot_api moves a real proposal to canary_caught', 'copilot_api', (s) => s`update proposed_actions set status = 'canary_caught' where id = 'act_real'`, 'P0001'],
  ['copilot_api rejects a canary instead of catching it', 'copilot_api', (s) => s`update proposed_actions set status = 'rejected' where id = 'act_canary'`, 'P0001'],
  ['copilot_executor approves', 'copilot_executor', (s) => s`update proposed_actions set status = 'approved' where id = 'act_real'`, 'P0001'],
  ['copilot_mcp reads security_events', 'copilot_mcp', (s) => s`select * from security_events`, '42501'],
  ['copilot_mcp inserts a case', 'copilot_mcp', (s) => s`insert into cases (id) values ('case_x')`, '42501'],
  ...(['copilot_api','copilot_executor','copilot_mcp'] as const).flatMap((role) => [
    [`${role} updates audit_log`, role, (s) => s`update audit_log set actor = 'x'`, '42501'],
    [`${role} deletes audit_log`, role, (s) => s`delete from audit_log`, '42501'],
    [`${role} updates security_events`, role, (s) => s`update security_events set ref_masked = 'x'`, '42501'],
    [`${role} deletes security_events`, role, (s) => s`delete from security_events`, '42501'],
  ]),
])('%s → %s', async (_, role, query, expected) => { … expect(await code(query(conn))).toBe(expected) });
```

plus positive cases: `copilot_api` `proposed → approved` on `act_real` succeeds; `copilot_executor` `approved → executed` on `act_appr` succeeds; `copilot_api` `canary_missed` on `act_canary` succeeds; `copilot_mcp` inserts one `security_events` row; `setRolePasswords` twice with a password containing `'` and `%` then logging in with it succeeds.

- [ ] **Step 2:** run → FAIL (roles do not exist / login refused).
- [ ] **Step 3: roles migration** (`drizzle-kit generate --custom --name=roles`):

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'copilot_api') THEN CREATE ROLE copilot_api NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'copilot_executor') THEN CREATE ROLE copilot_executor NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'copilot_mcp') THEN CREATE ROLE copilot_mcp NOLOGIN; END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO copilot_api, copilot_executor, copilot_mcp;
GRANT SELECT, INSERT, UPDATE ON webhook_events, cases, agent_runs, run_steps, resolutions TO copilot_api;
GRANT SELECT, INSERT ON proposed_actions TO copilot_api;
GRANT UPDATE (type, params, status, decided_by, decided_at, final_reply, reject_code, reject_reason, reply_edit_ratio, acknowledged_flags, reviewed_transaction_ids, operator_override) ON proposed_actions TO copilot_api;
GRANT SELECT ON action_executions, security_events, policy_chunks TO copilot_api;
GRANT SELECT, INSERT ON audit_log TO copilot_api;
GRANT SELECT ON proposed_actions, cases TO copilot_executor;
GRANT UPDATE (status) ON proposed_actions TO copilot_executor;
GRANT SELECT, INSERT, UPDATE ON action_executions TO copilot_executor;
GRANT INSERT ON audit_log TO copilot_executor;
GRANT INSERT ON security_events TO copilot_mcp;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_transition_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_canary IS DISTINCT FROM OLD.is_canary THEN
    RAISE EXCEPTION 'is_canary is immutable';
  END IF;
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'proposed' AND current_user = 'copilot_api' AND (
       (NOT OLD.is_canary AND NEW.status IN ('approved', 'rejected', 'superseded'))
    OR (OLD.is_canary AND NEW.status IN ('canary_caught', 'canary_missed', 'superseded'))
  ) THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' AND current_user = 'copilot_executor' AND NEW.status IN ('executed', 'failed') AND NOT OLD.is_canary THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'transition % → % refused for %', OLD.status, NEW.status, current_user;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS enforce_transition_role ON proposed_actions;
CREATE TRIGGER enforce_transition_role BEFORE UPDATE ON proposed_actions FOR EACH ROW EXECUTE FUNCTION enforce_transition_role();
```

- [ ] **Step 4: `roles.ts`** — `setRolePasswords` runs, per role, `select format('ALTER ROLE %I WITH LOGIN PASSWORD %L', ${role}, ${password}) as statement` then `sql.unsafe(statement)`; never logs the statement.
- [ ] **Step 5:** run → PASS; `pnpm verify` → 0; `invariant-reviewer` on the diff (G1).
- [ ] **Step 6:** commit `feat(api): add the three database roles and the transition trigger`.

### Task 4: Masking JSON logger (port, 02 G6 logger sink)

**Files:**

- Create: `apps/api/src/core/logging/json-console-logger.ts` (+ the `reason-of`/`stack-of` helpers it needs)
- Test: `apps/api/src/core/logging/json-console-logger.spec.ts` (ported tests, trimmed) plus new cases

**Interfaces:**

- Produces: `class JsonConsoleLogger` implementing Nest `LoggerService`, writing one JSON line per call through an injectable `write(line: string)` (default `process.stdout.write`).

- [ ] **Step 1:** port the Knowtis spec trimmed per 00 (drop Railway naming and database-error rewriting), and add failing cases: a message and a context object holding `4111111111111111`, `+52 55 1234 5678`, an `authorization: 'Bearer abc.def.ghi'` header, an `operatorToken` and a `caseToken` field → the written line has no `\d{8}`, no `abc.def.ghi`, and those three fields read `[redacted]`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** port the logger; in `printMessages` serialize through `maskJson` after replacing values under the keys `authorization`, `operatorToken`/`operator_token`, `caseToken`/`case_token`, `token` with `[redacted]` (case-insensitive key match); strings go through `maskPii`.
- [ ] **Step 4:** run → PASS; verify → 0.
- [ ] **Step 5:** commit `feat(port): bring the json logger from knowtis with pii masking`.

### Task 5: `api` boot, Dockerfile, `seed` service and compose wiring (02 G1 process boundary)

**Files:**

- Create: `apps/api/src/boot.ts`, `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/src/health.controller.ts`, `apps/api/src/seed/main.ts`, `apps/api/Dockerfile`, `apps/api/test/compose.spec.ts`
- Modify: `docker-compose.yml` (services `seed`, `api`; `mcp` depends on `seed`), `.env.example` (`API_DB_PASSWORD`, `EXECUTOR_DB_PASSWORD`, `MCP_DB_PASSWORD`, `API_DATABASE_URL`, `MCP_DATABASE_URL`, `API_PORT`), `.dockerignore`
- Test: `apps/api/src/boot.spec.ts`, `apps/api/test/compose.spec.ts`, `apps/api/src/health.controller.spec.ts` (Nest testing module under vitest — proves the decorator setup)

**Interfaces:**

- Produces: `assertApiEnv(env: NodeJS.ProcessEnv): void` (throws when `CORE_EXECUTOR_KEY` is defined); `GET /health → 200 {status:'ok'}`.

- [ ] **Step 1: failing tests** — `boot.spec.ts`: `assertApiEnv({ CORE_EXECUTOR_KEY: 'x' })` throws `/CORE_EXECUTOR_KEY/`, also for `''`; `assertApiEnv({})` does not. `compose.spec.ts`: parses `docker-compose.yml` with `yaml`; the services whose `environment` holds `CORE_EXECUTOR_KEY` are a subset of `['core-mock','executor']`; `api` and `seed` do not hold it; only `seed` holds `DATABASE_URL` (owner); `api` holds `API_DATABASE_URL` and `mcp` holds `MCP_DATABASE_URL`, each naming its own role. `health.controller.spec.ts`: `Test.createTestingModule({ controllers: [HealthController] })`, `app.getHttpServer()` with `fetch` → 200.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement `boot.ts`; `main.ts` calls `assertApiEnv(process.env)` before `NestFactory.create(AppModule, { logger: new JsonConsoleLogger() })`, listens on `API_PORT`; `seed/main.ts` runs `migrateDatabase(DATABASE_URL)` then `setRolePasswords` from the three password variables, logs `seed_done`; `Dockerfile` like `apps/mcp/Dockerfile` plus `apps/api/drizzle`; compose `seed` (`restart: 'no'`, depends on `db` healthy, command `node --import tsx src/seed/main.ts`), `api` (depends on `seed` `service_completed_successfully`, healthcheck on `/health`), `mcp` gains `depends_on.seed`.
- [ ] **Step 4:** run → PASS; verify → 0; `docker compose up -d --build seed api mcp` → `seed` exits 0, `api` and `mcp` healthy; `docker compose run --rm seed` again → exits 0 (idempotent).
- [ ] **Step 5:** commits `feat(api): refuse to boot holding the executor key`, `build: run migrations from a seed service before api and mcp`.

### Task 6: MCP Postgres security-event sink (02 G4)

**Files:**

- Modify: `apps/mcp/src/security-events.ts` (add `createPostgresSecurityEventSink(sql: Sql): SecurityEventSink`), `apps/mcp/src/main.ts` (use it with `MCP_DATABASE_URL`, remove the log-line sink and its comment), `apps/mcp/package.json` (`postgres`; devDep `@fintech-agent/api`), `apps/mcp/Dockerfile` unchanged except the new dep resolution
- Test: `apps/mcp/src/security-events.int.spec.ts`

**Interfaces:**

- Consumes: `startTestDatabase` from `@fintech-agent/api/test-database`; `createMcpApp`, `createCoreMock`.

- [ ] **Step 1: failing test** — start the test DB (owner inserts `case_t1`, `run_t1`), core-mock with a foreign transaction, `createMcpApp({ …, securityEvents: createPostgresSecurityEventSink(postgres(db.urlFor('copilot_mcp'))) })`; call `get_spei_status` with the foreign id over the SDK client → `NOT_FOUND`; as owner, `select kind, case_id, run_id, ref_masked from security_events` → exactly one row `cross_customer_lookup / case_t1 / run_t1 / <masked id>`.
- [ ] **Step 2:** run → FAIL (sink missing).
- [ ] **Step 3:** implement the sink with `sql\`insert into security_events (kind, case_id, run_id, ref_masked) values (${e.kind}, ${e.case_id}, ${e.run_id}, ${e.ref_masked})\``; `main.ts`requires`MCP_DATABASE_URL`.
- [ ] **Step 4:** run → PASS; verify → 0; compose `mcp` healthy and the foreign-lookup smoke writes a row (query as owner).
- [ ] **Step 5:** commit `feat(mcp): record security events in postgres as copilot_mcp`; spec 02 Tool binding row already says "Postgres from step 4".
