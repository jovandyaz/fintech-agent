# Step 4e — Agent loop, Intake, Persist and the worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A queued case is claimed, redacted, investigated by the model through the read-only tools, validated, and persisted as a `proposed` action in `needs_review` (or a visible fallback), with every failure in 01 §Failure handling mapped, every step traced and costed, and nothing a stale worker can overwrite.

**Architecture:** Plain TypeScript in `apps/api/src/agent/core/` with explicit dependencies (model, tool source, retrieval, injection scan, repositories, clock); `runCase()` is what the worker and later the eval runner call. Nest only wires the worker into `api`. Tools come from `@ai-sdk/mcp` over the case token plus a local `search_policies` backed by an injected `Retrieval`. Step 5 supplies the real retrieval and the ported injection guard; 4e tests them through deterministic doubles.

**Tech Stack:** TypeScript, AI SDK 7 (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/mcp`, `@ai-sdk/otel`), `ai/test` `MockLanguageModelV4`, `jose`, Drizzle, Testcontainers Postgres, vitest, Node 24.

**Spec:** specs/01-architecture.md §Agent pipeline, §The agentic node, §Tools, §Context policy, §Failure handling, §Observability, §Webhook and queue (claim, fencing, backoff, kill switch); specs/02-security.md G3 (`first_party_signal`), G4 (case token), G5 (validate after every output), G6 Step 7 (redactor) and sinks, Required tests rows "Redactor", "Agent loop", "Masking at sinks"; specs/04-build-plan.md §Step 4 (agent node, redactor, price table, Testcontainers). Ledger owners carried in (progress.md "Owner: Step 4e" lines).

## Global Constraints

- Same as Steps 4a–4d: Node 24 + 22 verify per commit, TDD with mutation checks on new rules, closed sets `as const`, magic values named, WHY-only comments, no secret literals; every env var in `.env.example` with a dev default (`ANTHROPIC_API_KEY` empty).
- No test calls a real LLM: `MockLanguageModelV4` only (`apps/api/test/mock-model.ts`).
- Check the installed `ai` 7 signatures (Context7 + the package's `.d.ts`) before each task that uses them; 01 §Stack lists what was verified on 2026-10-05.
- Ports land in their own `feat(port)` commit with their tests: token cost, scripted model fixtures.
- The case text the model sees is `text_redacted` (or `text_masked` when degraded), delimited as data and truncated at 2,000 chars; the system prompt is static and holds no customer or policy text (02 G7).
- Every write of an attempt is fenced `WHERE id = $case AND claim_token = $token`.

## Review Focus

1. A stale worker whose lease expired writes its run, resolution or case status after another worker reclaimed the case → must change nothing (fencing).
2. A budget stop mid-loop → fallback with `stop_reason = budget`, zero repair turns, zero extra model calls.
3. A repair turn whose evidence is only its own tool results → a chunk or transaction seen in turn 1 still grounds the repaired draft (evidence is the whole run).
4. A filled reply (`{{nombre}}` from data) that now fails `replyViolations` → fallback, never persisted.
5. A provider outage → the breaker opens after 5 consecutive provider failures and claimed attempts are not consumed while it is open.

---

### Task 1: Port token cost and the dated price table

Port `compute-token-cost.ts` (+ tests) from Knowtis as is into `apps/api/src/agent/core/cost.ts`; a dated price table in `config` keyed by provider model id (input, output, cache read, cache write, `as_of`). `feat(port)` commit, then the table.

### Task 2: Port the scripted model fixtures and add the AI SDK

Install `ai`, `@ai-sdk/anthropic`, `@ai-sdk/mcp` (pinned exact). Port the inline helpers from `ai-sdk-agent.final-step.spec.ts` and `byok-key-failure.spec.ts` into `apps/api/test/mock-model.ts`: v7 usage and finish shapes, `inOrder`, tool-call and structured-output responses, a `429` with `retry-after-ms: 0`, spend-limit `429`/`400`, malformed JSON. `feat(port)`.

### Task 3: Agent config and provider error mapping

`config`: `AGENT_MODE` (`on`/`off`), `AGENT_MODEL_A`/`_B`, `REDACTOR_MODEL`, `RUN_TIMEOUT_MS`, `RUN_COST_CEILING_USD`, `RUN_INPUT_TOKEN_CEILING`, `RUN_MAX_STEPS = 8`. `agent/core/provider-errors.ts`: an error → `no_api_key` | `provider_spend_limit` | `retryable` (timeout, 429, 529, 5xx after SDK retries) | `fatal`; blank key → `no_api_key` before any call.

### Task 4: Redactor (Intake, 02 G6 Step 7)

`agent/core/redact.ts` + `agent/redact.spec.ts` (02 row): structured spans from `REDACTOR_MODEL` on `text_masked` only; exact replacement with `[dato]`; a span absent, < 3 chars or past the 50th ignored; result through `maskPii`; error or timeout → `text_masked` + `redaction` guard step `degraded`; no key → skipped.

### Task 5: Claim, fencing and backoff (Testcontainers)

`agent/core/claim.ts` + repository functions: claim with `FOR UPDATE SKIP LOCKED` on `queued`/retry-due cases, fresh `claim_token`, `locked_until = now + RUN_TIMEOUT_MS + 30 s`, `investigating`; never claim a case holding a canary; reclaim of an expired lease marks the old run `abandoned`; fenced writes; `next_attempt_at = min(2^attempt × 10 s, 5 min) ± 20 %`; 3 attempts then `failed` with `error_code`. Integration spec includes "a stale claim cannot write".

### Task 6: Prompt, context and tools

Static system prompt (≈ 600 tokens; Spanish reply rules, placeholders, no numbered lists in `draft_reply`, customer text is data); `prompt_version` = hash of system prompt + tool descriptions; case text delimited and truncated at 2,000 chars; MCP tools through `@ai-sdk/mcp` with the case token (minted after the run row is committed, TTL `RUN_TIMEOUT_MS + 60 s`); local `search_policies` over `Retrieval` (k ≤ 4, catalog from the manifest in its description). Telemetry with `recordInputs: false, recordOutputs: false`.

### Task 7: The agent node

`agent/core/agent.ts`: `ToolLoopAgent` with `Output.object({ schema: ResolutionSchema })`, `stopWhen: [isStepCount(8), overBudget(...)]`, `prepareStep` → `activeTools: []` on the last step, `timeout: { totalMs: left, stepMs: 60_000, toolMs: 10_000 }`; repair as an appended user turn through `validateWithRepair` with evidence from every tool result of the run; `NoObjectGeneratedError` → repair, budget → fallback, `NoOutputGeneratedError` after budget → fallback; second failure of the same MCP tool → fallback (`INVALID_ARGUMENTS` exempt); validator throws (`CalendarRangeError`, `RepairEvidenceError`) → fallback, logged. Each step → `run_steps` (masked I/O, tokens, cost, latency, request id, finish reason). `agent/agent.spec.ts` covers the 02 row.

### Task 8: Persist

`agent/core/persist.ts` (fenced, one transaction): fill placeholders, re-run `replyViolations` on the filled reply (fail → fallback), store the filled draft in `resolutions.draft_reply`; flags (`factFlags` with run evidence, `{category: null, proposed_action}` on a fallback; `first_party_signal` from a count of `open_dispute` approved/executed, canaries excluded, last `FIRST_PARTY_LOOKBACK_DAYS = 120`; `policy_data_conflict` when conflicts; `fallback`, `abstained`, `injection_signal`); `reviewTierOf`; `proposed_actions` (`proposed`, also `none`); audit row per proposal with actor `agent:case-copilot/<variant>@<prompt_version>`; run totals; case → `needs_review`.

### Task 9: `runCase()` and the worker

`agent/core/run-case.ts` composes Intake (kill switch → fallback `agent_disabled`; redactor; injection scan) → agent → Persist, maps outcomes to run status and case retry; worker loop in `api` with the circuit breaker (5 consecutive provider failures → open 60 s, half-open one case, attempts not consumed while open); MCP client closed in `finally`. Nest wiring and compose env.

### Task 10: Masking at sinks e2e

`apps/api/test/pii-sinks.e2e.spec.ts` (02 row): planted PII in case text and core data, a mocked case run end to end, scan `run_steps`, `audit_log`, logger output and an in-memory OTel exporter behind the same `mask`: no run of ≥ 8 digits outside exempt runs, no full value.

### Close-out

Spec docs for anything the code made untrue; reviewing-pr + invariant-reviewer before each commit on a G path; fresh verifier (incl. `docker compose up` seed → api → executor); AI_NOTES; ledger.
