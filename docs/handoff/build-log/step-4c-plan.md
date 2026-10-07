# Step 4c — Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A separate `executor` process that drains `approved` actions as an outbox: claims with `SKIP LOCKED`, records `action_executions(started)`, re-validates G2 against fresh core-mock data, calls the matching core-mock write with `Idempotency-Key: <action_id>`, marks `executed` or `failed` with an audit row, and sweeps stale `started` rows so a crash can neither lose nor repeat an effect.

**Architecture:** Plain TypeScript under `apps/api/src/executor/` (no Nest), entrypoint `main.ts`, Postgres role `copilot_executor`, the only holder of `CORE_EXECUTOR_KEY`. Reads core-mock with the shared contracts client (core-mock accepts the executor key for reads); writes with a write client that lives only in `executor/`. Drizzle over postgres.js.

**Tech Stack:** drizzle-orm 0.45 (postgres-js 3.4), Zod 4, @testcontainers/postgresql 12.2, vitest 5, Node 24, tsx.

**Spec:** specs/02-security.md G1 (executor container and role; trigger `approved → executed | failed` only for `copilot_executor`, status only), G2 (table, re-checked by the executor), G3 ("Execution is an outbox", sweeper, `none` never executes, canaries never execute), Required tests row Executor; specs/01-architecture.md components `executor` and `apps/core-mock`, data model `action_executions`, failure handling row "Executor crash between started and the core-mock call"; specs/00-scope.md port table (isUniqueViolation). Ledger owners carried in: isUniqueViolation port; skip `none`; executor half of "a valid override executes once"; zero core-mock calls for a canary; SPEI policy window; second executable proposal on a re-run case.

## Global Constraints

- Same as Step 4b (Node 24 + 22 verify per commit, integration before its commit, TDD with mutation checks on first-run passes, no secret literals, `.env.example` + compose map-form env, closed sets `as const`, magic values named, zero comments by default).
- 02 G1: only `executor` and `core-mock` hold `CORE_EXECUTOR_KEY`; the executor connects as `copilot_executor`; it changes nothing on `proposed_actions` but `status`.
- 02 G3: one effect per action whatever crashes or repeats happen; a failed re-validation never calls core-mock; `none` and canaries are never written.

## Review Focus

1. Two executor instances drain at once → each action is claimed by one; the `action_executions` unique key turns a lost race into a skip, not an error.
2. Crash after the core-mock write but before `executed` is recorded → the sweeper retries with the same key, core-mock returns the first result, one effect.
3. Core-mock answers 5xx or times out → the row stays `started` for the sweeper; a 422 (`not_owned`, `key_reused`) is final → `failed`.
4. An approved action whose transaction now belongs to someone else, changed state, or a SPEI dispute inside the policy window → `failed` with the reason, no write.
5. Repeated sweeps of an action core-mock keeps refusing → bounded attempts, then `failed`.

---

### Task 1: Port `isUniqueViolation` (feat(port))

`apps/api/src/common/errors/unique-violation.ts` + spec: true only for SQLSTATE 23505 on the named constraint, through Drizzle's wrapping (DrizzleQueryError cause) and a bare PostgresError; false for other codes, other constraints, non-errors.

### Task 2: Core write client

`apps/api/src/executor/core-write-client.ts` + spec. `WRITE_ENDPOINT_BY_ACTION` (open_dispute → `/disputes`, resend_cep → `/cep/resend`, escalate_fraud → `/fraud/escalations`). `createCoreWriteClient({ baseUrl, executorKey, fetch })` → `write(type, body, idempotencyKey)` returning `{ outcome: 'accepted', result }` or `{ outcome: 'refused', reason }` (422), throwing `CoreUnavailableError` on network/5xx/timeout/out-of-contract. Sends `x-executor-key` and `Idempotency-Key`; never logs either. Lint: `core-write-client` already restricted outside executor.

### Task 3: Re-validation

`apps/api/src/executor/revalidate.ts` + spec: `revalidate(action, customerId, transactions, now)` → `null` or a closed reason (`not_owned`, `missing`, `shape`, `spei_window`). Uses `shapeViolation`; SPEI out disputes need `settled_at` older than `SPEI_DISPUTE_AFTER_HOURS` (contracts, 24).

### Task 4: Drain and sweep

`apps/api/src/executor/drain.ts` + `executor.int.spec.ts` (Testcontainers as `copilot_executor`, fake core with core-mock's idempotency semantics and a call log). `claimNext(db)`: one `approved`, non-canary, `type <> 'none'` action without an execution row, `FOR UPDATE SKIP LOCKED`, insert `started`. `execute(deps, claimed)`: re-read transactions, revalidate, write, then `executed`/`failed` + audit (`actor = executor`, masked detail). `sweep(deps, now)`: `started` older than `SWEEP_AFTER_MS` (2 min) → retry with the same key, `attempts + 1`, `failed` after `MAX_EXECUTION_ATTEMPTS`.
Tests (02 Executor row + owners): run twice → one write; crash after `started` → sweep → one write with the same key; crash after the write → sweep → core returns first result, one effect; foreign tx → `failed`, no write; SPEI inside the window → `failed`, no write; `none`, canary and rejected never claimed, zero calls; override executes once with its own params; 5xx stays `started`, 422 → `failed`; attempts cap; two concurrent drains → one claim.

### Task 5: Entrypoint and compose

`apps/api/src/executor/main.ts` (Zod config `EXECUTOR_DATABASE_URL`, `CORE_MOCK_URL`, `CORE_EXECUTOR_KEY`, `EXECUTOR_POLL_MS`; boot failures as one masked JSON line; graceful SIGTERM), compose service `executor` (same image as api, `depends_on` seed + core-mock), `.env.example`, `compose.spec` (executor holds the key, api does not), spawn boot test.

### Close-out

Spec docs commit (SPEI window constant, attempts cap, none/canary skip, second-proposal ruling); reviewing-pr + invariant-reviewer; fresh verifier (compose: approve via API → executor writes once → core-mock log line; crash simulation by stopping the executor after `started`); AI_NOTES; ledger.
