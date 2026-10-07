# 01 — Architecture

## Components

```text
ticket system (simulated)
        │  POST /webhooks/tickets   (idempotent, 202)
        ▼
┌──────────────────────── apps/api (NestJS) ────────────────────────┐
│ webhook → cases table (queue) → worker → agent harness            │
│                                              │                    │
│   approvals API ◄── console (operator token) │ read-only          │
│        │ approved row (outbox)               ▼                    │
└────────┼──────────────────────────── MCP client (case token) ─────┘
         ▼                                      │ Streamable HTTP
   executor (own container, only writer)        ▼
         │ write + Idempotency-Key        apps/mcp (4 read tools)
         ▼                                      │
   apps/core-mock  ◄──────── read ──────────────┘
   (dataset JSON)
```

| Unit | Tech | Responsibility |
| --- | --- | --- |
| `apps/api` | NestJS 11, Drizzle, Postgres 16 | Webhook, queue worker, agent harness, retrieval, approvals, traces, REST for the console. Postgres role `copilot_api`; refuses to start if `CORE_EXECUTOR_KEY` is set |
| `executor` | Same image as `api`, entrypoint `apps/api/src/executor/main.ts`, plain TS | Drains `approved` actions, re-validates, calls core-mock writes with an idempotency key, sweeps stale `started` rows. Only holder of `CORE_EXECUTOR_KEY`; Postgres role `copilot_executor` (02 G1) |
| `apps/mcp` | `@modelcontextprotocol/server` + `@modelcontextprotocol/node` (v2), plain TS | MCP server exposing four read-only tools; binds every call to the customer in the case token; masks PII at the boundary; records `cross_customer_lookup` in `security_events` through the insert-only `copilot_mcp` role |
| `apps/core-mock` | Small Node HTTP service | Serves the synthetic dataset; exposes the three write endpoints used only by the executor, each requiring the executor key and an `Idempotency-Key` stored under a unique constraint (a repeat returns the first result) |
| `apps/console` | React + Vite, TanStack Query | Inbox, new case form, run / re-run, case detail with trace, edit reply, decide |
| `packages/contracts` | Zod | Shared schemas: case, resolution, proposed action, trace step, API DTOs |
| `data/` | JSON + Markdown | Customers, transactions, policy docs, webhook fixtures. Generated once with a fixed seed and committed |
| `evals/` | promptfoo (Node API) | Labeled cases, runner, judge, calibration labels |
| `seed` (compose one-shot) | Node script | Idempotent: run migrations as the owner role (creating `copilot_api`, `copilot_executor` and `copilot_mcp`), check the policy manifest, ingest policy docs, exit. `api` and `executor` start after it succeeds |

Why four services instead of one: the trust boundary is physical. The process that runs the model holds an MCP client that can only read, and neither the executor key nor a database role that can record an execution. A bug in a prompt, or a compromised dependency in `api`, cannot reach a write path that process does not have.

The harness core (`apps/api/src/agent/core/`) is plain TypeScript with explicit dependencies (model, MCP client, retrieval, repositories). Nest only wires it, so the eval runner calls the same `runCase()` without Nest DI.

`docker compose up` starts everything with dev defaults for every secret (`${VAR:-dev-…}`); only `ANTHROPIC_API_KEY` must be set by the reviewer. Without it, runs fail fast with `error_code = no_api_key`, no retries, and the console says so.

pnpm workspaces, no Nx: four small packages do not justify it.

## Data model (Postgres)

| Table | Key columns | Notes |
| --- | --- | --- |
| `webhook_events` | `event_id` PK, `payload_hash`, `case_id`, `received_at` | Idempotency ledger |
| `cases` | `id`, `ticket_id` unique, `folio` unique, `received_at`, `source` (`webhook` · `console` · `eval`), `customer_id`, `text_masked`, `text_redacted`, `status`, `attempts`, `manual_reruns`, `locked_until`, `claim_token`, `next_attempt_at`, `category`, `flags` jsonb, `review_tier` | Also the queue. `status`: `queued → investigating → needs_review → resolved` (on the operator's decision), or `failed`; a manual re-run moves `needs_review`, `failed` or `resolved` back to `queued` (02 G3). `folio` is `AC-XXXX-XXXX`, Crockford base32, never more than 4 consecutive digits (02 G6 registry). `flags` is one closed set: `injection_signal`, `policy_data_conflict`, `action_fact_mismatch`, `first_party_signal`, `abstained`, `fallback`. `review_tier` is set by code at Persist: `high` if the action is `open_dispute` / `escalate_fraud` or `flags` is non-empty, else `standard`. The inbox sorts `high` first and hides `source = eval` by default. No model self-confidence is used |
| `agent_runs` | `id`, `case_id`, `variant`, `model` (exact provider id), `prompt_version` (hash of system prompt + tool descriptions), `status` (`running` · `succeeded` · `fallback` · `failed` · `abandoned`), `stop_reason` (`completed` · `budget` · `validation` · `agent_disabled` · `error`), token counts, `cost_usd`, `latency_ms`, `error_code` | One row per attempt |
| `run_steps` | `run_id`, `idx`, `kind` (`llm`, `tool`, `retrieval`, `guard`, `validation`), `name`, `input_masked`, `output_masked`, tokens, cost, `latency_ms`, `provider_request_id`, `finish_reason` | The trace the console renders |
| `resolutions` | `run_id`, `category`, `draft_reply`, `citations` jsonb, `abstained`, `reasoning_summary` | Validated agent output |
| `proposed_actions` | `id`, `case_id`, `run_id`, `agent_type`, `agent_params` jsonb, `type`, `params` jsonb, `justification`, `status`, `proposed_at`, `decided_by`, `decided_at`, `final_reply`, `reject_code`, `reject_reason`, `reply_edit_ratio`, `acknowledged_flags`, `reviewed_transaction_ids`, `operator_override`, `is_canary` | One row per case decision, also for `type = none`. `agent_*` hold the agent's proposal and never change; `type`/`params` are what executes, equal to them unless the operator overrides (02 G3). `status`: `proposed → approved → executed`, or `rejected`, `failed`, or `superseded` when a re-run replaces an undecided proposal; canaries end in `canary_caught` or `canary_missed` and are excluded from quality metrics. The operator's decision always stores `final_reply` (edited or not), approve or reject, and moves the case to `resolved`. `reject_code` ∈ `wrong_category`, `wrong_action`, `wrong_transactions`, `wrong_policy_or_ungrounded`, `missing_policy`, `tone`, `other`; an override counts as `wrong_action`. `reply_edit_ratio` = normalized edit distance from the placeholder-filled draft the operator saw to `final_reply`, computed on every decision: a heavy edit is a silent rejection. `is_canary` is never serialized to any DTO |
| `action_executions` | `action_id` unique, `status` (`started` · `executed` · `failed`), `attempts`, `started_at`, `finished_at`, `result` | Written only by `copilot_executor`. The unique key plus core-mock's idempotency key make the effect happen once (02 G3) |
| `audit_log` | `id`, `at`, `actor`, `event`, `ref`, `detail_masked`, `key_id`, `ip`, `user_agent` | Append-only; neither role has UPDATE or DELETE. `actor` is `operator:<id>` (from the operator token), `executor` or `agent:case-copilot/<variant>@<prompt_version>`, so every proposal names the agent version and every decision the human |
| `security_events` | `id`, `at`, `kind` (`cross_customer_lookup`), `case_id`, `run_id`, `ref_masked` | Inserted only by the MCP server's `copilot_mcp` role; read by the validator (`escalate_fraud` predicate) and by an alert |
| `policy_chunks` | `id`, `doc_id`, `section`, `content`, `keywords`, `tsv`, `state_rules` jsonb, `content_hash`, `quarantined` | Retrieval corpus. `content` is the normalized text (02 G8); `tsv` weights the section heading `A`, the manifest `keywords` (customer phrasings such as "no me llegó", "me cobraron") `B` and the body `D`, under the `es_unaccent` config. `state_rules` come from the doc's front matter, e.g. `{id: return_credit_same_day, applies_to: {type: spei_out, status: returned, returned_business_days_ago: ">=1"}, requires: {field: reversal_credit_id, not_null: true}}`. A rule is evaluated only on a transaction whose `get_spei_status` or `get_card_authorization` output the run actually received, and only on fields that output contains; a missing tool call never produces a conflict. Every non-quarantined rule whose `applies_to` matches runs, whether or not the chunk was cited (02 G5). Derived fields such as `returned_business_days_ago` are computed by the rule evaluator from the output's timestamps and `cases.received_at` with the business-day calendar |

State transitions are enforced three times: in a domain function (`transition(from, event)`), with a conditional `UPDATE … WHERE status = $expected` so two concurrent requests cannot both win, and by the `enforce_transition_role` trigger that ties each transition to one Postgres role (02 G1).

## Webhook and queue

- `POST /webhooks/tickets` body: `{ event_id, ticket_id, customer_id, text, created_at }` (≤ 32 KB). Signed per Standard Webhooks v1: `webhook-id` (must equal `event_id`), `webhook-timestamp`, `webhook-signature: v1,<base64 HMAC-SHA256>` over `${id}.${timestamp}.${rawBody}` with `WEBHOOK_SECRET`. Verified on the raw bytes (`NestFactory.create(…, { rawBody: true })`) with `timingSafeEqual` before parsing; a timestamp outside ±5 minutes → `401` (Stripe's default tolerance); several space-separated signatures are accepted so the secret can rotate.
- The console's new case form calls `POST /cases`; the API builds the event, signs it server-side and runs it through the same handler, so the secret never reaches the browser and console cases take the real path.
- One transaction: insert into `webhook_events` `ON CONFLICT (event_id) DO NOTHING`; if inserted, insert the case with `status = 'queued'`, a `folio` and `received_at`, and record the automatic acknowledgment (acuse) as sent (mocked). Commit, return `202 { case_id, folio }`. The acknowledgment never waits for the agent (LTOSF art. 23).
- Retry with the same `event_id` and same payload hash returns the original `case_id` with `200`. Same `event_id` with a different hash returns `409` and is logged.
- The `cases` row is the job: the worker claims with `SELECT … FOR UPDATE SKIP LOCKED` where `next_attempt_at <= now()`, sets a fresh `claim_token` (uuid) and `locked_until = now() + RUN_TIMEOUT_MS + 30 s`. Every write of that attempt carries `WHERE id = $1 AND claim_token = $2`, so a worker whose lease expired cannot overwrite the attempt that replaced it (fencing). No separate enqueue step means no window where the event is recorded and the job is lost.
- Failure: up to 3 attempts; the next one waits `min(2^attempt × 10 s, 5 min)` ±20 % jitter in `next_attempt_at`; then `failed` with `error_code`, visible in the console with a "re-run" button. Each attempt is a new `agent_runs` row.
- Kill switch: with `AGENT_MODE=off` the worker never calls the model; each claimed case goes to `needs_review` through the fallback path with `stop_reason = agent_disabled`, and the console shows a banner. Ops keeps working cases by hand (Monzo and DPD both rely on being able to turn the AI part off).

Chosen over pg-boss: the case row is the job, so job state and case status are one state machine with no second store to reconcile. pg-boss 12 can also enqueue inside the Drizzle transaction (`fromDrizzle`), so atomicity is not the reason; it becomes the choice with more job types or when a dead-letter queue and heartbeats are needed. A durable-execution engine (Temporal, DBOS, AI SDK `WorkflowAgent`) is not needed for a read-only loop of at most 8 steps: restarting it costs tokens, not correctness.

## Agent pipeline

A blueprint: deterministic nodes around one agentic node. Deterministic steps are code, not model judgment.

| # | Node | Kind | What it does |
| --- | --- | --- | --- |
| 1 | Intake | Deterministic + one model call | Load case (`text_masked`, deterministic, 02 G6 Steps 1–6). Run the model redactor on it and store `text_redacted` (02 G6 Step 7). Run the heuristic injection scan; record a flag, do not block. With `AGENT_MODE=off`, go straight to fallback. |
| 2 | Investigate | Agentic | Tool loop with the four MCP tools plus local `search_policies`. Ends in a typed `Resolution`. |
| 3 | Validate | Deterministic | Schema, provenance, quote, allow-list, fact-support, grounding, commitment, link, auth-factor and PII checks (02 G5). One repair retry with the validator's codes; then fall back. |
| 4 | Persist | Deterministic | Compute `action_fact_mismatch` and `first_party_signal`, `review_tier`. Write `resolutions`, `proposed_actions` (`proposed`), steps, costs. Case → `needs_review`. |
| 5 | Decide | Human | Authenticated operator edits the reply, checks off transactions on `high` tier, optionally overrides the action, approves or rejects. |
| 6 | Execute | Deterministic | Separate container. Runs only for `approved`; outbox with idempotency key; writes audit log. |

Fallback when validation fails twice or the model errors out: case goes to `needs_review` with `action = none`, an empty draft and a visible reason. The agent never guesses to fill the gap.

### The agentic node

- AI SDK 7 `ToolLoopAgent` with `output: Output.object({ schema: ResolutionSchema })`.
- `stopWhen: [isStepCount(8), overBudget(RUN_COST_CEILING_USD, RUN_INPUT_TOKEN_CEILING)]`, the second a custom stop condition over the steps' usage. Producing the structured output counts as a step, so `prepareStep` sets `activeTools: []` on the last allowed step to force the synthesis. Never `toolChoice: 'required'`: current Opus and Sonnet models reject forced tool use with `400`.
- `RUN_TIMEOUT_MS` bounds the whole attempt, repair included: each model call gets `timeout: { totalMs: <time left in the attempt>, stepMs: 60_000, toolMs: 10_000 }` instead of a hand-rolled abort signal, so the claim lease (`RUN_TIMEOUT_MS + 30 s`) and the case token (`RUN_TIMEOUT_MS + 60 s`) always outlive the attempt. A tool over its timeout comes back to the model as a tool error.
- A stop by budget goes to fallback with `stop_reason = budget`, never to repair: repairing would spend more after the ceiling. `NoObjectGeneratedError` from a malformed output goes to the repair retry; a `NoOutputGeneratedError` after a budget stop goes to fallback.
- Repair appends the validator's codes to the run's messages as a new user turn; earlier turns are never edited, because thinking blocks are bound to the exact prefix and an edited history is rejected.
- The model never receives `customer_id` as a tool parameter. Identity travels in the MCP transport header as a short-lived case token minted by the harness (see 02).
- AI SDK `toolApproval` was considered for the gate and rejected: approval here must survive process restarts, belong to a named operator and be auditable days later. That is a database state machine, not a message in a turn.

`ResolutionSchema` (in `packages/contracts`):

```ts
{
  category: enum[ 'spei_outgoing_not_received', 'spei_incoming_not_credited',
                  'unrecognized_card_charge', 'card_purchase_declined',
                  'general_inquiry', 'out_of_scope_or_suspicious' ],
  draft_reply: string,              // Spanish, for the customer
  citations: [{ chunk_id, doc_id, section, quote }],   // ≥1 unless abstained; quote ≤ 200 chars, verbatim from the chunk
  abstained: boolean,               // true = no policy support found
  evidence: [{ kind: 'transaction' | 'spei' | 'card_auth', id }],
  proposed_action: { type: 'open_dispute' | 'resend_cep' | 'escalate_fraud' | 'none',
                     transaction_ids: string[], reason_code: enum, justification: string },
  reasoning_summary: string         // shown to ops; not chain-of-thought
}
```

No free-text amount, CLABE or account field exists anywhere in the action. The executor derives every value it needs from `transaction_ids`. `quote` replaces the Anthropic Citations API, which cannot be combined with structured outputs (`CITATION_QUOTE_MISMATCH`, 02 G5).

### Tools

| Tool | Input (no `customer_id`) | Output (masked) |
| --- | --- | --- |
| `get_customer` | — | First name only, account status, masked CLABE, card last 4, card status, KYC level. Name + surnames + another identifier is "Información Personal" under the CNBV–Banxico IFPE rules, so the full name never reaches the model; the harness fills `{{nombre}}` after validation |
| `list_transactions` | `type?`, `status?`, `from?`, `to?`, `min_amount?`, `max_amount?`, `query?`, `limit` (default 10, max 25), `cursor?` | Compact rows (card purchases include merchant descriptor, channel and `auth_factors`; SPEI rows the counterparty's first name and masked CLABE, for the same IFPE reason as `get_customer`) + `total` + `next_cursor` + `truncated` |
| `get_spei_status` | `transaction_id` | Id, type, amount, state, timestamps, `tracking_key_last4`, return, hold or reject reason, `reversal_credit_id` (for returned SPEI out), `cep_available` |
| `get_card_authorization` | `transaction_id` | Id, status, amount, timestamp, decision, decline reason code, merchant (descriptor and brand), `auth_factors` (count of independent factors; 3DS maps here), channel |
| `search_policies` (local) | `query`, `k` (max 4), `doc_id?` | Chunks with `chunk_id`, `doc_id`, `section`, `content`. The tool description lists the policy catalog (id and title, generated from the manifest, never from doc bodies), so the model can query in the policies' own words; it is static and part of `prompt_version` |

All MCP tools carry `readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false`; annotations are informational (the spec calls them untrusted) and G1 is the guarantee. `tools/list` order is fixed. A lookup of an id that belongs to another customer returns `NOT_FOUND` as a tool result with `isError: true`, the same as a missing id, and raises a security event. More than 12 calls on one case token return `RATE_LIMITED` (02 G4). Tool errors are a closed set (`MCP_TOOL_ERRORS` in `packages/contracts`): `NOT_FOUND`, `WRONG_TYPE` (a SPEI id sent to the card tool or the reverse, checked only after ownership), `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE` (core-mock down, failing or answering garbage), `INVALID_ARGUMENTS` (with the offending field paths, never values; the server validates arguments itself so bad input stays inside the closed set and the 12-call budget, while `tools/list` still advertises the schemas) and `INTERNAL`; none carries a raw error message, which would bypass `maskJson`. Output schemas live in `packages/contracts` so the validator parses the same shapes. `transaction_id` must be a `tx_` registry id and `from`/`to` are inclusive ISO 8601 datetimes with an offset (a bare date would be read as UTC midnight). Core-mock answers are parsed against their record schemas; one outside the contract is `UPSTREAM_UNAVAILABLE`, never a foreign record, so bad upstream data cannot raise a false `cross_customer_lookup`.

### Retrieval

Postgres full-text search with a `es_unaccent` configuration (`COPY = spanish`, mapping through `unaccent` then `spanish_stem`), so `devolucion` finds `devolución`. The query is an OR of the query's lexemes ranked with `ts_rank_cd`, not `plainto_tsquery`, which ANDs every word and misses "cuánto tarda un SPEI en llegar" against a section titled "Tiempos SPEI". Embeddings are not used: the corpus is about ten short docs, `pgvector` is not in the `postgres:16-alpine` image, and `retrieval.spec.ts` measures recall instead of assuming it. Putting the whole corpus in the prompt (Anthropic's advice below 200k tokens) was rejected because it would make every chunk "seen" and empty `CITATION_UNSEEN`, and would place the poisoned 09b in every run.

## Context policy

What enters the context, and when:

| Content | When | Bound |
| --- | --- | --- |
| System instructions | Always; static, cache-friendly prefix | ~600 tokens |
| Case text (`text_redacted`, delimited as data) | Always | Truncated at 2,000 chars |
| Customer summary | Only if the model calls `get_customer` | Fixed shape |
| Transactions | Only via `list_transactions` with filters | ≤25 compact rows per call; never the full history |
| Transaction detail | Only via the two `get_*` tools | One record per call |
| Policy text | Only via `search_policies` | ≤4 chunks, ≤350 tokens each |

A customer with 200 movements cannot overflow the window: the list tool is paginated and filtered, returns a `total` so the model knows more exists, and each tool result is capped with an explicit `truncated: true` marker. Run budget: 8 steps, a hard input-token ceiling and a per-run USD ceiling (`RUN_COST_CEILING_USD`); exceeding any ends the run in the fallback path with `stop_reason = budget`. Manual re-runs are capped at 3 per case (`cases.manual_reruns`); the webhook rejects bodies over 32 KB with `413`.

## Failure handling

| Failure | Handling |
| --- | --- |
| Provider timeout | `timeout.stepMs` / `totalMs`; counts as a retryable error |
| 429 / 529 / 5xx | SDK retries, max 2, honoring `retry-after`; then job-level retry with backoff |
| Provider spend limit (`429` `enforced_spend_limit_reached`, or `400` "specified API usage limits") | Not retryable, like `no_api_key`: `error_code = provider_spend_limit`. A dedicated Anthropic workspace with its own spend limit backs `RUN_COST_CEILING_USD` (README) |
| Provider outage (5 consecutive `429`/`529`/`5xx` after SDK retries) | Worker circuit breaker: stops claiming for 60 s, then half-open with one case; attempts are not consumed while open, so an outage does not turn every case `failed` |
| Redactor error or timeout | Continue on `text_masked`; `redaction` guard step marked `degraded`; counted for the alert |
| Agent turned off (`AGENT_MODE=off`) | No model call; case → `needs_review`, `action = none`, `stop_reason = agent_disabled`; console banner |
| Invalid or schema-violating JSON | One repair attempt with the validation error; then fallback |
| MCP tool error | Returned to the model as a tool error once; second failure of the same tool ends the run in fallback |
| Mock core down | Tool error path; case stays re-runnable |
| Worker crash mid-run | `locked_until` expires; another attempt starts with a new `claim_token`; the old one can no longer write; partial run row marked `abandoned` |
| Executor crash between `started` and the core-mock call | Sweeper retries after 2 min with the same `Idempotency-Key`; core-mock returns the first result if the write had landed (02 G3) |
| No API key configured | Run ends at once with `error_code = no_api_key`, no retries; console shows it |
| Policy contradicts account data | Not resolved by the model: the `state_rules` of any matching chunk, cited or not, fail against the transactions seen → `POLICY_DATA_CONFLICT`, action forced to `none`, flag `policy_data_conflict`, shown to ops |

## Observability

- **Source of truth:** `agent_runs` and `run_steps` in Postgres, masked on write. The console trace and the evals read from here, so they work with no external service.
- **OpenTelemetry** through AI SDK telemetry (`invoke_agent`, `chat`, `execute_tool` spans with `gen_ai.usage.*`), with `recordInputs: false, recordOutputs: false` by default: the GenAI semantic conventions are still in Development and make content opt-in, and the SDK records it by default. Content is recorded only with the `maskJson` span processor wired. **Optional:** Langfuse as one more span processor (`LangfuseSpanProcessor` with `mask`). Off when keys are absent.
- **Per step:** tokens in/out, cached input tokens (priced separately, when the provider reports them), cost (from a dated price table in config), latency, tool name, masked args, provider request id and finish reason.
- **Alerts**, in `ops/alerts.sql`. Thresholds are starting points to recalibrate against the first weeks of shadow data; each has a minimum sample so a quiet hour cannot page:

  | Alert | Threshold | Owner |
  | --- | --- | --- |
  | `action_executions` row without an operator decision | Any | Page: on-call + security |
  | Canary catch rate per operator | < 100% over that operator's last 20 canaries | Ticket: ops lead (coaching, not blame) |
  | `open_dispute` still `proposed` | > 1 business day after `received_at` (the 18.a credit is due on the 2nd) | Page: ops lead |
  | Oldest queued case | > 15 min | Page: on-call |
  | Fallback or provider error rate | > 10% over 30 min, n ≥ 10 | Page: on-call |
  | Rejected or approved with `reply_edit_ratio` > 0.3 | > baseline + 10 pp over 7 days, n ≥ 20 | Ticket: AI lead |
  | Injection flag or validation block rate | > 3× the 7-day median, n ≥ 10 | Ticket: AI lead + security |
  | Cost per case p95 | > 2× baseline | Ticket: AI lead |
  | PII sink scan (digit runs ≥ 8 outside exempt runs in logs and traces) | Any hit | Page: security |
  | `cross_customer_lookup` in `security_events` | Any | Ticket: security |
  | `security_event_unrecorded` in MCP logs (a lost fraud signal) | Any | Page: security |
  | Redactor degraded | > 5% of intakes over 1 h, n ≥ 20 | Ticket: AI lead |
- **Dashboards, not pages:** cost per case p50/p95, cache-read share, fallback rate, steps per run, rejects by `reject_code`, approved → `executed` rate (vs `failed`), time-to-decision p50.

## Stack and verified APIs

Checked against official docs and npm on 2026-10-05. Re-check signatures against the installed version before coding each step.

| Area | Package (latest seen) | Verified facts | Source |
| --- | --- | --- | --- |
| Agent loop | `ai` 7.0.128 | `ToolLoopAgent`; default `stopWhen: isStepCount(20)`; `stopWhen` accepts an array (any condition stops); `hasToolCall`; `prepareStep` can set `activeTools`; `timeout: number \| { totalMs, stepMs, toolMs }`; per-call `toolsContext` | <https://ai-sdk.dev/docs/agents/building-agents> , <https://ai-sdk.dev/docs/agents/loop-control> |
| Structured output | `ai` | `output: Output.object({ schema })`; output generation counts as a step; `NoObjectGeneratedError`, `NoOutputGeneratedError` | <https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data> |
| Tools | `ai` | `tool({ description, inputSchema, execute, contextSchema })`; `onStepEnd`; `toolApproval` exists (not used) | <https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling> |
| MCP client | `@ai-sdk/mcp` 2.0.67 | `createMCPClient({ transport: { type: 'http', url, headers } })`; speaks the stateless 2026-07-28 protocol and falls back to `initialize` for legacy servers; `tools({ schemas })`; `close()` | <https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools> |
| Test doubles | `ai/test` | `MockLanguageModelV4` with `doGenerate`; `mockValues` | <https://ai-sdk.dev/docs/ai-sdk-core/testing> |
| MCP server | `@modelcontextprotocol/server` 2.3.1, `@modelcontextprotocol/node` 2.1.1 | Stable line implementing protocol 2026-07-28 (no sessions, no `initialize`); `createMcpHandler(({ authInfo }) => new McpServer(…))` builds a server per request; `registerTool` with Standard Schema input; the v1 package `@modelcontextprotocol/sdk` 1.32.1 stops at 2025-11-25 | <https://ts.sdk.modelcontextprotocol.io/v2/serving/http> , <https://modelcontextprotocol.io/specification/2026-07-28/changelog> |
| Case token | `jose` 6.2.12 | `SignJWT`, `jwtVerify(token, key, { algorithms, issuer, audience })` | <https://github.com/panva/jose> |
| Webhook signature | `standardwebhooks` 1.1.1 | Standard Webhooks v1 reference implementation; check its verify API at step 7, or hand-roll the ~20-line check with `timingSafeEqual` | <https://github.com/standard-webhooks/standard-webhooks> |
| Tracing | `@ai-sdk/otel` 1.0.128 (`recordInputs`/`recordOutputs` default on), `@langfuse/otel` 5.13.0 optional | `new LangfuseSpanProcessor({ mask })`; masks input, output, metadata | <https://langfuse.com/docs/observability/features/masking> |
| Evals | `promptfoo` 0.124.0 | Node API `evaluate`; `javascript`, `llm-rubric`, `cost`, `latency` assertions; per-test `options.repeat` (since 0.121.18), each repeat index cached separately, so the runner disables the cache | <https://www.promptfoo.dev/docs/configuration/test-cases> |

Version decisions:

- **NestJS 11**, not 12 (current `latest`): the ported patterns and my agent rules are written for 11; an upgrade is not what this challenge measures.
- **MCP SDK v2** (`@modelcontextprotocol/server` + `/node`), protocol 2026-07-28: it is the stable line, `@ai-sdk/mcp` speaks it by default, and the server is a rewrite anyway (00), so the Knowtis v1 code is reference only. Fallback if v2 costs more than 15 minutes at step 3: v1 1.32 with the client's protocol discovery turned off for legacy servers; the ruling goes in the ledger.
- **Models:** set by env (`AGENT_MODEL_A`, `AGENT_MODEL_B`, `JUDGE_MODEL`, `REDACTOR_MODEL`, a Haiku-class model). Variant A is a Sonnet-class model, variant B a Haiku-class model; the judge is a different model from the one being judged. Exact ids are pinned in `.env.example` at implementation time.
