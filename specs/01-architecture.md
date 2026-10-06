# 01 — Architecture

## Components

```text
ticket system (simulated)
        │  POST /webhooks/tickets   (idempotent, 202)
        ▼
┌──────────────────────── apps/api (NestJS) ────────────────────────┐
│ webhook → cases table (queue) → worker → agent harness            │
│                                              │                    │
│   approvals API ◄── console                  │ read-only          │
│        │                                     ▼                    │
│   executor (only writer)            MCP client (case token)       │
└────────┼─────────────────────────────────────┼────────────────────┘
         │ write                                │ Streamable HTTP
         ▼                                      ▼
   apps/core-mock  ◄──────── read ────────  apps/mcp (4 read tools)
   (dataset JSON)
```

| Unit | Tech | Responsibility |
| --- | --- | --- |
| `apps/api` | NestJS 11, Drizzle, Postgres 16 | Webhook, queue worker, agent harness, retrieval, approvals, executor, traces, REST for the console |
| `apps/mcp` | `@modelcontextprotocol/sdk`, plain TS | MCP server exposing four read-only tools; binds every call to the customer in the case token; masks PII at the boundary |
| `apps/core-mock` | Small Node HTTP service | Serves the synthetic dataset; exposes the three write endpoints used only by the executor |
| `apps/console` | React + Vite, TanStack Query | Inbox, new case form, run / re-run, case detail with trace, edit reply, decide |
| `packages/contracts` | Zod | Shared schemas: case, resolution, proposed action, trace step, API DTOs |
| `data/` | JSON + Markdown | Customers, transactions, policy docs, webhook fixtures. Generated once with a fixed seed and committed |
| `evals/` | promptfoo (Node API) | Labeled cases, runner, judge, calibration labels |
| `seed` (compose one-shot) | Node script | Idempotent: run migrations, ingest policy docs, exit. `api` starts after it succeeds |

Why three services instead of one: the trust boundary is physical. The agent process holds an MCP client that can only read; the write client exists only in the executor module. A bug in a prompt cannot reach a write path that the process running the model does not call.

The harness core (`apps/api/src/agent/core/`) is plain TypeScript with explicit dependencies (model, MCP client, retrieval, repositories). Nest only wires it, so the eval runner calls the same `runCase()` without Nest DI.

`docker compose up` starts everything with dev defaults for every secret (`${VAR:-dev-…}`); only `ANTHROPIC_API_KEY` must be set by the reviewer. Without it, runs fail fast with `error_code = no_api_key`, no retries, and the console says so.

pnpm workspaces, no Nx: four small packages do not justify it.

## Data model (Postgres)

| Table | Key columns | Notes |
| --- | --- | --- |
| `webhook_events` | `event_id` PK, `payload_hash`, `case_id`, `received_at` | Idempotency ledger |
| `cases` | `id`, `ticket_id` unique, `folio` unique, `received_at`, `source` (`webhook` · `console` · `eval`), `customer_id`, `text_masked`, `status`, `attempts`, `manual_reruns`, `locked_until`, `category`, `flags` jsonb, `review_tier` | Also the queue. `status`: `queued → investigating → needs_review → resolved` (on the operator's decision), or `failed`. `flags` is one closed set: `injection_signal`, `ungrounded_number`, `commitment_language`, `policy_data_conflict`, `abstained`, `fallback`. `review_tier` is set by code at Persist: `high` if the action is `open_dispute` / `escalate_fraud` or `flags` is non-empty, else `standard`. The inbox sorts `high` first and hides `source = eval` by default. No model self-confidence is used |
| `agent_runs` | `id`, `case_id`, `variant`, `model` (exact provider id), `prompt_version` (hash of system prompt + tool descriptions), `status` (`running` · `succeeded` · `fallback` · `failed` · `abandoned`), `stop_reason`, token counts, `cost_usd`, `latency_ms`, `error_code` | One row per attempt |
| `run_steps` | `run_id`, `idx`, `kind` (`llm`, `tool`, `retrieval`, `guard`, `validation`), `name`, `input_masked`, `output_masked`, tokens, cost, `latency_ms` | The trace the console renders |
| `resolutions` | `run_id`, `category`, `draft_reply`, `citations` jsonb, `abstained`, `reasoning_summary` | Validated agent output |
| `proposed_actions` | `id`, `case_id`, `run_id`, `type`, `params` jsonb, `justification`, `status`, `proposed_at`, `decided_by`, `decided_at`, `final_reply`, `reject_code`, `reject_reason`, `reply_edit_ratio`, `acknowledged_flags` | One row per case decision, also for `type = none`. `status`: `proposed → approved → executed`, or `rejected`, `failed`. The operator's decision always stores `final_reply` (edited or not), approve or reject, and moves the case to `resolved`. `reject_code` ∈ `wrong_category`, `wrong_action`, `wrong_transactions`, `wrong_policy_or_ungrounded`, `missing_policy`, `tone`, `other`. `reply_edit_ratio` = normalized edit distance from `draft_reply` to `final_reply`, computed on every decision: a heavy edit is a silent rejection |
| `action_executions` | `action_id` unique, `executed_at`, `result` | Unique key makes execution at-most-once |
| `audit_log` | `id`, `at`, `actor`, `event`, `ref`, `detail_masked` | Append-only; no UPDATE or DELETE granted to the app role. `actor` is `operator:<id>` or `agent:case-copilot/<variant>@<prompt_version>`, so every proposal names the agent version and every decision the human |
| `policy_chunks` | `id`, `doc_id`, `section`, `content`, `tsv`, `state_rules` jsonb, `content_hash`, `quarantined` | Retrieval corpus. `state_rules` come from the doc's front matter, e.g. `{id: return_credit_same_day, applies_to: {type: spei_out, status: returned, returned_business_days_ago: ">=1"}, requires: {field: reversal_credit_id, not_null: true}}`. A rule is evaluated only on a transaction whose `get_spei_status` or `get_card_authorization` output the run actually received, and only on fields that output contains; a missing tool call never produces a conflict (02 G5) |

State transitions are enforced twice: in a domain function (`transition(from, event)`) and with a conditional `UPDATE … WHERE status = $expected` so two concurrent requests cannot both win.

## Webhook and queue

- `POST /webhooks/tickets` body: `{ event_id, ticket_id, customer_id, text, created_at }` (≤ 32 KB). HMAC signature header verified against a stub secret.
- The console's new case form calls `POST /cases`; the API builds the event, signs it server-side and runs it through the same handler, so the secret never reaches the browser and console cases take the real path.
- One transaction: insert into `webhook_events` `ON CONFLICT (event_id) DO NOTHING`; if inserted, insert the case with `status = 'queued'`, a `folio` and `received_at`, and record the automatic acknowledgment (acuse) as sent (mocked). Commit, return `202 { case_id, folio }`. The acknowledgment never waits for the agent (LTOSF art. 23).
- Retry with the same `event_id` and same payload hash returns the original `case_id` with `200`. Same `event_id` with a different hash returns `409` and is logged.
- The `cases` row is the job: the worker claims with `SELECT … FOR UPDATE SKIP LOCKED`, sets `locked_until`. No separate enqueue step means no window where the event is recorded and the job is lost.
- Failure: up to 3 attempts with backoff; then `failed` with `error_code`, visible in the console with a "re-run" button. Each attempt is a new `agent_runs` row.

Chosen over pg-boss: about 60 lines, atomic with the idempotency insert, nothing extra to operate. pg-boss is the first thing to adopt at higher volume.

## Agent pipeline

A blueprint: deterministic nodes around one agentic node. Deterministic steps are code, not model judgment.

| # | Node | Kind | What it does |
| --- | --- | --- | --- |
| 1 | Intake | Deterministic | Load case. Mask PII in customer text. Run the heuristic injection scan; record a flag, do not block. |
| 2 | Investigate | Agentic | Tool loop with the four MCP tools plus local `search_policies`. Ends in a typed `Resolution`. |
| 3 | Validate | Deterministic | Schema, provenance, allow-list, grounding and PII checks (see 02). One repair retry with the validator's error; then fall back. |
| 4 | Persist | Deterministic | Write `resolutions`, `proposed_actions` (`proposed`), steps, costs. Case → `needs_review`. |
| 5 | Decide | Human | Operator edits reply, approves or rejects. |
| 6 | Execute | Deterministic | Separate module. Runs only for `approved`; idempotent; writes audit log. |

Fallback when validation fails twice or the model errors out: case goes to `needs_review` with `action = none`, an empty draft and a visible reason. The agent never guesses to fill the gap.

### The agentic node

- AI SDK 7 `ToolLoopAgent` with `output: Output.object({ schema: ResolutionSchema })`.
- `stopWhen: isStepCount(8)`. Producing the structured output counts as a step, so `prepareStep` disables tools on the last allowed step to force the synthesis.
- `NoObjectGeneratedError` / `NoOutputGeneratedError` are caught and routed to the repair retry, not surfaced as a crash.
- The model never receives `customer_id` as a tool parameter. Identity travels in the MCP transport header as a short-lived case token minted by the harness (see 02).
- AI SDK `toolApproval` was considered for the gate and rejected: approval here must survive process restarts, belong to a named operator and be auditable days later. That is a database state machine, not a message in a turn.

`ResolutionSchema` (in `packages/contracts`):

```ts
{
  category: enum[ 'spei_outgoing_not_received', 'spei_incoming_not_credited',
                  'unrecognized_card_charge', 'card_purchase_declined',
                  'general_inquiry', 'out_of_scope_or_suspicious' ],
  draft_reply: string,              // Spanish, for the customer
  citations: [{ chunk_id, doc_id, section }],   // ≥1 unless abstained
  abstained: boolean,               // true = no policy support found
  evidence: [{ kind: 'transaction' | 'spei' | 'card_auth', id }],
  proposed_action: { type: 'open_dispute' | 'resend_cep' | 'escalate_fraud' | 'none',
                     transaction_ids: string[], reason_code: enum, justification: string },
  reasoning_summary: string         // shown to ops; not chain-of-thought
}
```

No free-text amount, CLABE or account field exists anywhere in the action. The executor derives every value it needs from `transaction_ids`.

### Tools

| Tool | Input (no `customer_id`) | Output (masked) |
| --- | --- | --- |
| `get_customer` | — | First name only, account status, masked CLABE, card last 4, KYC level. Name + surnames + another identifier is "Información Personal" under the CNBV–Banxico IFPE rules, so the full name never reaches the model; the harness fills `{{nombre}}` after validation |
| `list_transactions` | `type?`, `status?`, `from?`, `to?`, `min_amount?`, `max_amount?`, `query?`, `limit` (default 10, max 25), `cursor?` | Compact rows + `total` + `next_cursor` |
| `get_spei_status` | `transaction_id` | State, timestamps, tracking key, return reason, hold reason, `reversal_credit_id` (for returned SPEI out), CEP availability |
| `get_card_authorization` | `transaction_id` | Decision, decline reason code, merchant (descriptor and brand), `auth_factors` (count of independent factors; 3DS maps here), channel |
| `search_policies` (local) | `query`, `k` (max 4) | Chunks with `chunk_id`, `doc_id`, `section` |

All MCP tools carry `readOnlyHint: true`. A lookup of an id that belongs to another customer returns `NOT_FOUND`, the same as a missing id, and raises a security event.

## Context policy

What enters the context, and when:

| Content | When | Bound |
| --- | --- | --- |
| System instructions | Always; static, cache-friendly prefix | ~600 tokens |
| Case text (masked, delimited as data) | Always | Truncated at 2,000 chars |
| Customer summary | Only if the model calls `get_customer` | Fixed shape |
| Transactions | Only via `list_transactions` with filters | ≤25 compact rows per call; never the full history |
| Transaction detail | Only via the two `get_*` tools | One record per call |
| Policy text | Only via `search_policies` | ≤4 chunks, ≤350 tokens each |

A customer with 200 movements cannot overflow the window: the list tool is paginated and filtered, returns a `total` so the model knows more exists, and each tool result is capped with an explicit `truncated: true` marker. Run budget: 8 steps, a hard input-token ceiling and a per-run USD ceiling (`RUN_COST_CEILING_USD`); exceeding any ends the run in the fallback path with `stop_reason = budget`. Manual re-runs are capped at 3 per case (`cases.manual_reruns`); the webhook rejects bodies over 32 KB with `413`.

## Failure handling

| Failure | Handling |
| --- | --- |
| Provider timeout | Per-step abort signal; counts as a retryable error |
| 429 / 5xx | SDK retries with backoff, max 2; then job-level retry |
| Invalid or schema-violating JSON | One repair attempt with the validation error; then fallback |
| MCP tool error | Returned to the model as a tool error once; second failure of the same tool ends the run in fallback |
| Mock core down | Tool error path; case stays re-runnable |
| Worker crash mid-run | `locked_until` expires; another attempt starts; partial run row marked `abandoned` |
| No API key configured | Run ends at once with `error_code = no_api_key`, no retries; console shows it |
| Policy contradicts account data | Not resolved by the model: a cited chunk's `state_rules` fail against the transactions seen → `POLICY_DATA_CONFLICT`, action forced to `none`, flag `policy_data_conflict`, shown to ops |

## Observability

- **Source of truth:** `agent_runs` and `run_steps` in Postgres, masked on write. The console trace and the evals read from here, so they work with no external service.
- **Optional:** Langfuse through OpenTelemetry (`LangfuseSpanProcessor` with a `mask` function, AI SDK telemetry integration). Off when keys are absent.
- **Per step:** tokens in/out, cached input tokens (priced separately, when the provider reports them), cost (from a dated price table in config), latency, tool name, masked args.
- **Alerts worth paging for:** (1) share of proposals rejected **or approved with `reply_edit_ratio` > 0.3** over a rolling window — quality drift; (2) validation-block or injection-flag rate above baseline — attack or regression; (3) age of the oldest queued case **and of the oldest `proposed` action awaiting a decision** — pipeline or review stalled, and disputes are deadline-bound (02 regulatory).
- **Dashboards, not pages:** cost per case p50/p95, cache-read share, fallback rate, steps per run, rejects by `reject_code`, approved → `executed` rate (vs `failed`), time-to-decision p50.

## Stack and verified APIs

Checked against official docs and npm on 2026-10-05. Re-check signatures against the installed version before coding each step.

| Area | Package (latest seen) | Verified facts | Source |
| --- | --- | --- | --- |
| Agent loop | `ai` 7.0.128 | `ToolLoopAgent`; default `stopWhen: isStepCount(20)`; `hasToolCall`; `prepareStep` can set `activeTools`, `toolChoice`; per-call `toolsContext` | <https://ai-sdk.dev/docs/agents/building-agents> , <https://ai-sdk.dev/docs/agents/loop-control> |
| Structured output | `ai` | `output: Output.object({ schema })`; output generation counts as a step; `NoObjectGeneratedError`, `NoOutputGeneratedError` | <https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data> |
| Tools | `ai` | `tool({ description, inputSchema, execute, contextSchema })`; `onStepEnd`; `toolApproval` exists (not used) | <https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling> |
| MCP client | `@ai-sdk/mcp` 2.0.67 | `createMCPClient({ transport: { type: 'http', url, headers } })`; `tools({ schemas })`; `close()` | <https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools> |
| Test doubles | `ai/test` | `MockLanguageModelV4` with `doGenerate`; `mockValues` | <https://ai-sdk.dev/docs/ai-sdk-core/testing> |
| MCP server | `@modelcontextprotocol/sdk` 1.32.1 | `McpServer.registerTool`; stateless Streamable HTTP (`sessionIdGenerator: undefined`); handler `extra.authInfo` / `extra.requestInfo` | <https://github.com/modelcontextprotocol/typescript-sdk> |
| Tracing | `@langfuse/otel`, `@langfuse/vercel-ai-sdk` 5.13.0 | `new LangfuseSpanProcessor({ mask })`; masks input, output, metadata | <https://langfuse.com/docs/observability/features/masking> |
| Evals | `promptfoo` 0.124.0 | Node API `evaluate`; `javascript`, `llm-rubric`, `cost`, `latency`, `trajectory:*` assertions; `--repeat` | <https://www.promptfoo.dev/docs/configuration/expected-outputs/> |

Version decisions:

- **NestJS 11**, not 12 (current `latest`): the ported patterns and my agent rules are written for 11; an upgrade is not what this challenge measures.
- **MCP SDK v1** (`@modelcontextprotocol/sdk`), not the v2 split packages (`@modelcontextprotocol/server` 2.3.1): the Knowtis reference code and the `@ai-sdk/mcp` examples target v1, which is still published and current; the server is small enough that moving to v2 later is cheap.
- **Models:** set by env (`AGENT_MODEL_A`, `AGENT_MODEL_B`, `JUDGE_MODEL`). Variant A is a Sonnet-class model, variant B a Haiku-class model; the judge is a different model from the one being judged. Exact ids are pinned in `.env.example` at implementation time.
