# Step 4e Task 9c — Wire the agent worker into `api` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docker compose up` runs the agent worker inside `api`: queued cases are claimed and run through `runCase` with the real retrieval, injection scan, MCP tools and Anthropic models (or end `no_api_key` / `agent_disabled` without a model call), and the worker stops cleanly on shutdown.

**Architecture:** A plain-TypeScript factory (`agent/core/deps.ts`) builds `RunCaseDeps` and `WorkerDeps` from `ApiConfig`; a small Nest module (`agent/agent-worker.module.ts`) only wires it: it starts `runWorker` on bootstrap with an `AbortController` and awaits it on shutdown. `AGENT_WORKER=off` leaves `api` HTTP-only (tests, and an operator who wants the queue paused without the kill switch's fallbacks).

**Tech Stack:** NestJS 11 lifecycle hooks, `@ai-sdk/anthropic` 4.0.72 `createAnthropic({ apiKey })`, Drizzle, Testcontainers, vitest, Node 24.

**Spec:** specs/01-architecture.md §Components (worker in `api`), §Webhook and queue (claim, poll, kill switch), §Failure handling (breaker, no key); specs/02-security.md G1 (agent module imports), G4 (case token), G6 (logs masked), G7 (intake scan); ledger owners "Step 5 close → Task 9c", "Owner 9c" lines (catalog from the checked manifest; `api` depends_on `mcp` healthy; compose.spec asserts only `api` and `mcp` hold `CASE_TOKEN_KEY`; `sleep` swallows aborts, `onError` masks).

## Global Constraints

- Same as Steps 4–5: commit-gate per commit (Node 24 + 22, `--int` on G paths), TDD with mutation checks, WHY-only comments, magic values named, no secret literals; every new env var in `.env.example` and compose with a dev default.
- Nest only wires; the factory is plain TypeScript and testable without Nest.
- No test calls a real LLM; with no key the model factory is `null` (`no_api_key`).
- The agent module still imports nothing from executor, approvals, the core read client or `core-mock` (G1 lint).

## Review Focus

1. Shutdown while a case is mid-run → the worker stops claiming, the in-flight attempt finishes or its lease expires and is reclaimed; no unhandled rejection, the process exits.
2. A manifest whose title the guard flags → `api` refuses to boot (the catalog reaches every run).
3. `AGENT_WORKER=off` → no claim ever, the HTTP API still serves.
4. A database blip during a claim → reported masked, the loop continues.
5. Blank `ANTHROPIC_API_KEY` → a claimed case ends `no_api_key`, `failed`, no retry, no MCP connection.

---

### Task 1: The deps factory

`agent/core/deps.ts`: `runCaseConfigOf(config)` (variant → model id, budget, timeouts, MCP url/audience, case-token key), `modelsOf(apiKey)` (`createAnthropic({ apiKey })` or `null` for a blank key), `loadCatalog(dir)` (runs `loadCorpus` so a refused corpus or flagged title throws, returns `policyCatalog`), `runCaseDepsOf({ config, db, log, catalog })` with `createRetrieval`, `injectionSignal`, `connectCaseTools`, `Date.now`, `Math.random`. Unit tests: variant B picks `AGENT_MODEL_B`; blank key → `null`; flagged title → throws; deps wire the real functions.

### Task 2: The worker module

`AGENT_WORKER` (`on`/`off`, default `on`) and `AGENT_POLL_MS` (default 1,000) in config, `.env.example`, compose. `AgentWorkerModule.register(config)`: on bootstrap starts `runWorker({ claim: claimNextCase(db, …), run: runCase(deps, ·), breaker: createBreaker(Date.now), sleep: abortable wait that never rejects, signal, onError: masked log })`; on shutdown aborts and awaits. `api-app.ts` sets `AGENT_WORKER=off`. Integration (`agent-worker.int.spec.ts`, real Nest app + Testcontainers): `AGENT_MODE=off` → a queued case reaches `needs_review` with `agent_disabled`; blank key → `failed` `no_api_key`; `AGENT_WORKER=off` → the case stays `queued`; shutdown resolves.

### Task 3: Compose

`api` depends_on `mcp` `service_healthy`; `AGENT_WORKER`, `AGENT_POLL_MS` env; compose.spec: only `api` and `mcp` hold `CASE_TOKEN_KEY`; `api` waits for `mcp` healthy. Smoke: `docker compose up` logs `agent_worker_started`.

### Task 4: Close-out

Spec docs (01 Components/queue: the switch), reviews (task + invariant, G1/G4/G6/G7 paths), fresh verifier incl. `docker compose up`, ledger, handoff, push.
