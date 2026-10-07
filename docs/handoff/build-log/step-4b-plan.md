# Step 4b — Approval gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An authenticated operator decides a proposal through the API: approve (optionally with an override inside the G2 table) or reject, with `final_reply` checked like a draft, flags acknowledged, `high`-tier and override transactions checked off, a conditional transition, an audit row, and the case resolved; plus manual re-runs, `pnpm canary:inject` and the canary catch-rate alert query.

**Architecture:** Pure domain functions (`transition`, G2 shape, reply checks, edit ratio) in plain TypeScript; a Nest `approvals` module and a `cases` module wire them with `OperatorGuard`, a Zod pipe and Drizzle repositories as `copilot_api`. One database transaction per decision: conditional `UPDATE … WHERE status = 'proposed'`, case `needs_review → resolved`, `audit_log` insert. Ownership of override transactions is read from core-mock with the read key. The G1 trigger stays the last line.

**Tech Stack:** NestJS 11.2, drizzle-orm 0.45 (postgres-js 3.4), Zod 4, @testcontainers/postgresql 12.2, vitest 5, Node 24, tsx.

**Spec:** specs/02-security.md G2 (table), G3 (all bullets), G5 rows `PII_IN_REPLY`, `LINK_IN_REPLY`, `AUTH_FACTOR_REQUEST`, Required tests: Approval gate, Operator identity, Override and forcing function, Re-runs, Canaries, Flag acknowledgment; specs/01-architecture.md Data model (`cases`, `proposed_actions`, `audit_log`, `resolutions`), Alerts (canary catch rate); specs/00-scope.md port table (exfiltration link scanner); specs/04-build-plan.md §Step 4. Ledger owners carried in: jsonb `$type`, CHECK on `cases.flags`, canaries own case and run.

## Global Constraints

- Node 24 via `fnm exec --using=24 --`; pnpm only; versions pinned. Check Context7 before a library API.
- Commits: one line, Conventional Commits, English, imperative, ≤72 chars, no trailers. Port: `feat(port): … from knowtis` with its tests. Each commit verified alone (stash the rest), `pnpm verify` on Node 24 **and** the global Node 22 (the Stop hook's), integration specs before their commit.
- TDD: each behavior test fails first for the right reason; mutation-check tests that pass on first run.
- No secret literal; new variables in `.env.example` with dev defaults and in compose's map-form `environment`.
- Closed sets `as const` in contracts; magic values named; zero comments by default, WHY-only, JSDoc on exports.
- 02 G3: the decision DTO is strict with no operator field; operator from token only; zero rows updated → 409; every transition writes `audit_log` with operator id, key id, IP, user agent and masked detail.
- 02 G1: `api` never holds `CORE_EXECUTOR_KEY`; decisions run as `copilot_api`; the trigger refuses anything the API gets wrong.
- 02 G6: `audit_log.detail_masked` and logs pass `maskJson`; operator tokens never logged; `is_canary` never in a DTO.

## Review Focus

1. Two operators approve the same proposal at once → exactly one 200, the other 409, one audit row (conditional update, not read-then-write).
2. An override naming a transaction of another customer, or an id that does not exist → 400 with the same body (no ownership oracle), and core-mock unreachable → 503, never an approval without the ownership check.
3. `acknowledged_flags` with the right flags in another order or duplicated → accepted as a set; a superset or subset → 400.
4. A token that is a prefix of a valid one, the right token with trailing whitespace, a `Bearer` with different case → 401 except the case-insensitive scheme; comparison is constant-time on SHA-256 digests.
5. A canary decided by an operator → its response and every later read say only `canary_missed`/`canary_caught` after the decision, never `is_canary`, and no `action_executions` row can exist for it.

---

### Task 1: Typed jsonb, the flags CHECK and gate config

**Files:**

- Modify: `packages/contracts/src/schemas.ts` (add `ActionParamsSchema = z.strictObject({ transaction_ids, reason_code })`, type `ActionParams`; `DecisionSchema.final_reply` gains `.max(MAX_REPLY_CHARS)` = 4000), `apps/api/src/database/schema.ts` (`.$type<CaseFlag[]>()` on `cases.flags` and `acknowledged_flags`, `.$type<ActionParams>()` on `agent_params`/`params`, `.$type<string[]>()` on `reviewed_transaction_ids`), `apps/api/src/config.ts` (`OPERATOR_TOKENS`, `CORE_MOCK_URL`, `CORE_READ_KEY`), `.env.example`, `docker-compose.yml` (api env), `apps/api/test/compose.spec.ts` if it pins api env.
- Create: `apps/api/drizzle/0006_flags-closed-set.sql` (custom): `CHECK (jsonb_typeof(flags) = 'array' AND flags <@ '[…CASE_FLAGS…]'::jsonb)` on `cases.flags`, and the same on `proposed_actions.acknowledged_flags` when not null.
- Test: `apps/api/test/schema.int.spec.ts` (new), `apps/api/src/config.spec.ts` (new), `packages/contracts/src/schemas.spec.ts`.

**Interfaces:**

- Produces: `ActionParams`, `ActionParamsSchema`, `MAX_REPLY_CHARS`; `ApiConfig.OPERATOR_TOKENS: string`, `CORE_MOCK_URL: string`, `CORE_READ_KEY: string`.

- [ ] Failing tests: every member of `CASE_FLAGS` inserts into `cases.flags` as `copilot_api`; `["unknown"]`, `{}` and `"x"` → 23514 (check violation); the CHECK's literal list equals `CASE_FLAGS` (read `pg_get_constraintdef`, parse, compare) so contracts and DB cannot drift; same for `acknowledged_flags`. Config: missing `OPERATOR_TOKENS` → throws; valid env parses. Schema: a 4001-char `final_reply` fails `DecisionSchema`.
- [ ] Implement; `drizzle-kit generate` → "No schema changes" after the custom migration; integration green.
- [ ] Commits: `feat(contracts): add action params and cap the final reply`, `feat(api): type jsonb columns and close cases.flags in the database`, `feat(api): add operator tokens and core read config`.

### Task 2: `transition()` for proposals and cases

**Files:** Create `apps/api/src/approvals/transition.ts`, `apps/api/src/cases/case-transition.ts`; Test their `.spec.ts`.

**Interfaces:**

- Produces: `ACTION_EVENTS = ['approve','reject','supersede','execute','fail'] as const`; `transition(from: ActionStatus, event: ActionEvent, isCanary: boolean): ActionStatus | null` (null = refused); `caseRerun(status: CaseStatus, manualReruns: number): 'queued' | null` with `MAX_MANUAL_RERUNS = 3`.

- [ ] Failing test: the full from × event × canary matrix against an oracle written from 02 G3 (approve: proposed→approved, canary→canary_missed; reject: proposed→rejected, canary→canary_caught; supersede: proposed→superseded; execute/fail: approved→executed/failed on non-canary only; everything else null). `caseRerun`: needs_review/failed/resolved with <3 → queued; queued/investigating or 3 → null.
- [ ] Implement as a lookup, not branching; PASS; commit `feat(api): add the proposal and re-run transitions`.

### Task 3: `OperatorGuard` with hashed per-operator tokens

**Files:** Create `apps/api/src/approvals/operator-tokens.ts`, `operator.guard.ts`; Test `operator-tokens.spec.ts`, `operator.guard.spec.ts`.

**Interfaces:**

- `OPERATOR_TOKENS` format: `id:keyId:token` entries separated by `,` (ids `[a-z0-9_-]+`, token ≥ 24 chars, no `:`/`,`); `.env.example` default `ana:k1:dev-operator-ana-token-0123456789,beto:k1:dev-operator-beto-token-0123456789`.
- Produces: `parseOperatorTokens(raw): OperatorCredential[]` (`{ operatorId, keyId, digest: Buffer }`, plaintext dropped), `resolveOperator(credentials, presented: string): Operator | null` (SHA-256 the presented token, `timingSafeEqual` against **every** digest, no early return), `interface Operator { id: string; keyId: string; actor: \`operator:${string}\` }`, `OperatorGuard`setting`request.operator`, decorator `CurrentOperator()`.

- [ ] Failing tests: malformed entries, duplicate token, short token → parse throws naming the entry index, never the token; no header / `Basic …` / unknown / prefix of a valid token / token + space → null → 401 with `WWW-Authenticate: Bearer`; `bearer` scheme case-insensitive; resolves `ana`/`k1`.
- [ ] Implement; PASS; commit `feat(api): authenticate operators with hashed per-operator tokens`.

### Task 4: Reply checks (port the link scanner)

**Files:** Create `apps/api/src/replies/link-scanner.ts` (port), `apps/api/src/replies/reply-checks.ts`; `packages/contracts/src/schemas.ts` (`REPLY_CHECK_CODES = ['PII_IN_REPLY','LINK_IN_REPLY','AUTH_FACTOR_REQUEST'] as const`); Test both specs.

**Interfaces:**

- Produces: `hasLinkOutsideAllowList(text: string, allowedHosts: readonly string[]): boolean`; `ALLOWED_REPLY_HOSTS = ['albo.mx'] as const`; `replyViolations(text: string): ReplyCheckCode[]` (`PII_IN_REPLY` when `maskPii(text) !== text`; `LINK_IN_REPLY` from the scanner; `AUTH_FACTOR_REQUEST` when a request verb governs NIP/CVV/CVC/OTP/contraseña/token/código de seguridad/clave dinámica within a bounded window and no negation (`nunca`, `no te (pediremos|solicitaremos)`) precedes it). 4d's validator reuses `replyViolations` for the draft.

- [ ] Port commit: `assertNoExfiltrationLink` + helpers from knowtis `apps/api/src/modules/agent/eval/assertions.ts:253-327` and its bypass tests, trimmed: attacker host → "host not in the allow-list" (subdomains of allowed hosts pass), add raw HTML (`<a`, `<img`, any `<tag`) and bare domains (label ≥ 2 chars, letter TLD ≥ 2) as violations; Spanish replies without links pass. Commit `feat(port): add the exfiltration link scanner from knowtis`.
- [ ] Failing tests for `replyViolations`: a full CLABE, a card number, a phone → PII; `![](https://evil.example/?d=…)`, `<img src=…>`, `evil.ly/x`, `https://albo.mx.evil.com` → LINK; `https://albo.mx/ayuda` → clean; "envíanos tu NIP", "compártenos el código que te llegó por SMS", "¿nos confirmas tu CVV?" → AUTH; "nunca te pediremos tu NIP ni tu CVV" → clean; a plain approved reply → `[]`. Commit `feat(api): check replies for PII, links and auth factor requests`.

### Task 5: G2 shape and override ownership

**Files:** Create `apps/api/src/actions/allowed.ts` (pure G2 table), `apps/api/src/core-read/core-read-client.ts`; Test both specs.

**Interfaces:**

- Produces: `G2_TRANSACTION_COUNTS: Record<ActionType, {min, max}>` (open_dispute 1–3, resend_cep 1–1, escalate_fraud 0–5, none 0–0); `shapeViolation(type, transactions: readonly Transaction[]): string | null` checking count, uniqueness and the "Allowed when" states (open_dispute: card purchase `settled`/`pending` or SPEI out `settled`; resend_cep: SPEI `settled`); the policy-window part stays with the executor (4c re-validates fully). `createCoreReadClient({ baseUrl, readKey, fetch? })` → `getTransaction(id): Promise<Transaction | null>` (404 → null, other non-2xx or network → throws `CoreUnavailableError`), parsed with the contracts transaction schema.
- Consumes: `Transaction` from contracts core.

- [ ] Failing tests: each row of the G2 table at and beyond its bounds; duplicate ids; resend_cep on a pending SPEI; open_dispute on a declined card purchase; client: 200 parses, 404 → null, 500 and connection refused → `CoreUnavailableError`, read key sent as the header core-mock expects, never logged.
- [ ] G1/G4 lint: add `**/core-read`, `**/core-read/**` to the agent block's restricted imports (static and dynamic) with a planted case in `g1-lint.spec.ts`, so the model's data still comes only through the MCP tools.
- [ ] Implement; commit `feat(api): check actions against the g2 table and read core transactions`.

### Task 6: Decision API

**Files:** Create `apps/api/src/approvals/{approvals.module.ts, approvals.controller.ts, decide.ts, edit-ratio.ts, zod.pipe.ts}`, `apps/api/src/common/http/request-meta.ts` (ip, user agent); Modify `app.module.ts`; Test `apps/api/src/approvals/decide.int.spec.ts` (Testcontainers, fake core client), `approvals.controller.spec.ts` (HTTP: 400/401/409 shapes), `edit-ratio.spec.ts`.

**Interfaces:**

- Route: `POST /actions/:actionId/decision`, body `DecisionSchema`, guard `OperatorGuard`. Response `{ action_id, status }` (no `is_canary`).
- `decide(deps: { db, core, now }, input: { actionId, decision, operator, meta }): Promise<DecisionResult>` — plain TS, Nest only wires it.
- `editRatio(draft, final): number` = Levenshtein / max(length), 0 for equal, bounded by `MAX_REPLY_CHARS`.

Order inside one transaction (each failure aborts it): load action + case + resolution (404 unknown id); status ≠ `proposed` → 409; `replyViolations(final_reply)` → 400 `{ codes }`; acknowledged flags as a set ≠ `cases.flags` → 400; approve: target = override ?? agent params; override → G2 shape on core-read transactions, all owned by `cases.customer_id` (missing or foreign → the same 400), core down → 503; forcing function (`high` tier with transactions, or any override) → `reviewed_transaction_ids` as a set must equal the target's; `transition()`; conditional `UPDATE proposed_actions … WHERE id = $1 AND status = 'proposed'` (0 rows → 409) writing decided_by = operator actor, decided_at, final_reply, reject fields, edit ratio, acknowledged flags, reviewed ids, `type`/`params`, `operator_override`; `UPDATE cases SET status = 'resolved' WHERE id = $1 AND status = 'needs_review'` (0 rows → 409); `INSERT audit_log` (`actor`, `event` = `decision.approve|reject`, `ref` = action id, `detail_masked` = `maskJson({ status, acknowledged_flags, override, reject_code })`, `key_id`, `ip`, `user_agent`).

- [ ] Failing tests, one per 02 row: approve/reject store `final_reply` and resolve the case; approve on a non-proposed → 409; double approve → second 409 and one audit row; **concurrent** double approve (two connections, `Promise.all`) → one 200 + one 409; rejected and `none` leave zero `action_executions` (and approve of `none` records only the reply); audit row has operator id, key id, IP, UA; `final_reply` with a CLABE, a link, a CVV request → 400; body with `operator` → 400; no/unknown token → 401; override outside G2 or foreign/missing tx → 400 (same body); valid override → approved with `agent_*` unchanged and `operator_override = true`; `high` tier with wrong `reviewed_transaction_ids` → 400; override on `standard` without check-off → 400; flagged case without/with the right `acknowledged_flags` → 400/approved with the ack in `audit_log`; canary approve → `canary_missed`, reject → `canary_caught`, zero `action_executions`; no response or contracts schema has an `is_canary` key; core down on override → 503 and the row stays `proposed`.
- [ ] Implement; integration + verify green; invariant-reviewer on the task diff before committing (gate, not delegated blind). Commits: `feat(api): add the reply edit ratio`, `feat(api): decide proposals behind the operator guard`.

### Task 7: Manual re-runs

**Files:** Create `apps/api/src/cases/{cases.module.ts, cases.controller.ts, rerun.ts}`; Test `rerun.int.spec.ts`.

**Interfaces:** `POST /cases/:caseId/rerun` behind `OperatorGuard` → `{ case_id, status: 'queued', manual_reruns }`. One transaction: `UPDATE cases SET status='queued', manual_reruns = manual_reruns + 1, attempts = 0, next_attempt_at = now(), locked_until = null, claim_token = null WHERE id = $1 AND status IN (…) AND manual_reruns < 3` (0 rows → 404 if absent, else 409); `UPDATE proposed_actions SET status = 'superseded' WHERE case_id = $1 AND status = 'proposed'`; audit `case.rerun`.

- [ ] Failing tests (02 Re-runs): needs_review/failed/resolved → queued with the open proposal superseded; deciding the superseded one → 409; 4th re-run → 409; decided proposals untouched; queued/investigating → 409; unknown → 404.
- [ ] Commit `feat(api): let an operator re-run a case at most three times`.

### Task 8: Canaries and the catch-rate query

**Files:** Create `apps/api/src/canaries/{templates.ts, inject.ts, main.ts}`, `ops/alerts.sql`, `apps/api/package.json` script `canary:inject` (root alias `pnpm canary:inject`); Test `inject.int.spec.ts`, `apps/api/test/alerts.int.spec.ts`.

**Interfaces:**

- `CANARY_DEFECTS = ['wrong_transaction','none_on_disputable','wrong_supported_action','misstated_policy','wrong_category','cold_tone'] as const`; one template per defect built from a `data/scenarios.ts` scenario's customer and transactions (the defect lives in the proposal or draft only).
- `injectCanaries(sql, { count, now }): Promise<string[]>` as `copilot_api`: each canary gets **its own** `cases` row (`source = 'webhook'`, `needs_review`, `standard`, real-looking folio/ticket), its own `agent_runs` row whose `variant`/`model`/`prompt_version` copy the latest real run (no real run yet → throws "no run to mirror"), a `resolutions` row and a `proposed_actions` row with `is_canary = true`.
- `ops/alerts.sql` first query `canary_catch_rate`: per operator over their last 20 decided canaries, rows where caught/decided < 1.

- [ ] Failing tests: one canary per defect exists, each on its own case and run; nothing in the inserted case/run/resolution differs in shape from a real one except `is_canary`; inject before any real run → throws; approve via `decide()` → `canary_missed`; alert query on a fixture (operator A 20/20 caught, B 19/20) returns only B.
- [ ] Commits: `feat(api): inject canary proposals that mirror real ones`, `feat(ops): add the canary catch-rate alert query`.

### Close-out

- Spec docs commit for any ruling that changes 01/02 text (route names, api holds `CORE_READ_KEY`, `OPERATOR_TOKENS` format).
- `reviewing-pr` on the 4b range + `invariant-reviewer`; fix pass; `verifying-change` with a fresh verifier (compose: decide over HTTP with curl as each operator, 401/400/409 paths, canary inject + approve, audit rows); AI_NOTES entry; ledger `Step 4b: complete`.
