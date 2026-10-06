# 00 — Scope

## Goal

A small, reliable slice of a Case Copilot: an agent that investigates a customer case with read-only internal tools and policies, proposes a resolution, and leaves every consequential action to a human in ops. The brief's target effort is 6–8 focused hours; this build deliberately exceeds it (see Time budget) because every residual risk the first draft accepted was replaced by the control the industry uses.

Priority order when time runs out (from the brief): security and evals first, then harness reliability, then breadth of dataset, then UI.

## In scope

| # | Requirement | Slice we build |
| --- | --- | --- |
| 1 | Simulated internal system | Seeded generator → committed JSON (20 customers, ~200 movements: SPEI in/out, card purchases; states settled, pending, returned, rejected). A tiny mock core API serves it. |
| 2 | Tools via MCP | One MCP server, four read-only tools: `get_customer`, `list_transactions`, `get_spei_status`, `get_card_authorization`. Protocol 2026-07-28 (stateless Streamable HTTP), MCP SDK v2. |
| 3 | RAG knowledge base | 10 synthetic policy docs in Markdown (8 clean, citing the real regulation where one exists, plus 2 poisoned on purpose) under a hashed manifest, chunked by section, Spanish full-text search with accent folding, recall measured by a test. Mandatory citation with a verbatim quote, or explicit abstention. |
| 4 | Agent | Investigates, classifies, drafts a reply, optionally proposes one structured action with justification. |
| 5 | Ops console | Operator sign-in with a per-operator token, inbox, "new case" form (posts through the webhook), run / re-run agent on any case, case view with trace (tool calls + reasoning summary), editable reply, transaction check-off on `high` tier, action override, approve / reject with the effect named on the button. |
| 6 | Inbound webhook | `POST /webhooks/tickets`, Standard Webhooks signature with replay window, async processing, idempotent on retries. |
| — | The twist | Read-only agent whose actions must be supported by data, typed proposals, human gate with authenticated operators and canary proposals, executor in its own container, untrusted content as data, fail-closed PII masking. See 02. |
| — | Evals | 24 labeled cases (10 adversarial, one through a tool output), one-command runner, two variants compared with intervals, regression gate on the high-stakes set. See 03. |
| — | Docs | DESIGN.md, EVALS.md, PLAYBOOK.md, AI_NOTES.md, README with one-command start. |

## Explicitly cut (and why)

| Cut | Why |
| --- | --- |
| Auth / SSO | Out of scope per brief. Minimal per-operator bearer tokens replace a stub header, so every approval is attributable (02 G3); OIDC with MFA is in DESIGN.md. |
| Real ticketing, real messaging, real money movement | Mocked. The executor writes to the mock core only. |
| Streaming UI, websockets | Polling is enough for an inbox; streaming adds failure modes without changing any evaluated guarantee. |
| Multi-agent orchestration, long-term memory, conversation threads | One case = one run. Not needed to answer a case; each adds attack surface. |
| Dual-LLM / quarantined-LLM pattern | Considered. Privilege separation plus a deterministic gate gives the guarantee and is testable without an LLM. Documented as "with more time" in DESIGN.md. |
| Model failover chains, BYOK, quotas | Exists in Knowtis; over-building here. Single model per variant, bounded retries. |
| Vector retrieval, hybrid RRF | 10 short docs; Spanish full-text search with accent folding finds the right section and keeps ingestion key-less. Added when `retrieval.spec.ts` recall@4 drops below 0.9 or the corpus passes ~50 docs (needs the `pgvector` image). |
| Redis / external queue, durable-execution engine | The case row is the job, so one state machine; a read-only loop of ≤ 8 steps restarts for the cost of tokens. pg-boss, DBOS or Temporal are in DESIGN.md for when the executor or job types grow. |
| Polished UI, multi-language, Terraform, fine-tuning | Out of scope per brief. |

## Assumptions (documented, not asked)

1. Cases and replies are in Spanish (Mexico). Code, specs and docs are in English, except PLAYBOOK.md, which is written in Spanish for albo teams that are not AI experts.
2. One webhook event = one case. The emitter retries with the same `event_id`.
3. Actions are limited to three: open a dispute (aclaración), resend a CEP receipt, escalate to fraud. None of them moves money; all still require approval because they touch customer data or trigger downstream work.
4. A refund is not an action the agent can propose at all. A request for one is answered with the policy path (dispute) or escalated. The regulated credit for an unrecognized charge (Banxico Circ. 12/2018, 18.a: by the 2nd business day unless two-factor authentication is proven) is part of the dispute process `open_dispute` starts, not an agent action; the reply may state it only when it cites the policy.
5. The reviewer runs with their own API key for evals; unit and integration tests run with no key.
6. A single ops operator works a case at a time; no concurrent-edit handling beyond optimistic state checks.
7. albo is an IFPE (authorized in DOF 2022-05-12), so LTOSF art. 23 (aclaraciones), Banxico Circ. 12/2018 (IFPE operations), Circ. 14/2017 (SPEI) and the CNBV–Banxico IFPE rules apply. The synthetic policy docs use the real deadlines from those texts, cited, and are marked synthetic. Sources in [references.md](references.md).
8. Intake is the customer's notice. The legally required acknowledgment (acuse with folio) is an automatic template at intake, never gated on the agent; sending it is mocked. The agent's draft is never the dictamen. Legal should confirm the "intake = notice" reading.

## Reuse from Knowtis (declared)

Code is ported from my open-source project `jovandyaz/knowtis-app` (MIT) only where porting is faster than writing and brings no Knowtis coupling. Each port lands in its own commit with the `port` scope (`feat(port): …`), comes with its tests, and is listed in AI_NOTES.md and DESIGN.md.

Audited on 2026-10-05 for imports, debt markers, tests, fix history and version drift (Knowtis runs ai 7.0.85, MCP SDK 1.29, promptfoo 0.121, Langfuse 5.11; this repo targets the versions in 01). `<api>` = `apps/api/src/modules/`, `<eval>` = `<api>/agent/eval/`.

| Piece | From | Verdict and trim | Step |
| --- | --- | --- | --- |
| Injection guard + corpus | `packages/ai-gateway/src/guard/` (no imports, 111 tests) | **Port with trim** (~330 LOC with tests): drop the windowing-only exports (`locateInjectionPatterns`, spans, scopes, `runAnchored`) and their tests; swap Knowtis-specific benign strings for fintech ones; carry over the known quoted-phrase false positive as a documented case. NFKC + zero-width/bidi only, no homoglyph folding: a signal, never the guarantee | 5 |
| MCP `annotations.ts` | `apps/mcp/src/tools/` | **Port as is** (27 LOC) if its types fit SDK v2; otherwise rewrite the four hints inline | 3 |
| MCP wrapper, error format, server, transport | `apps/mcp/src/` | **Rewrite** (~90 LOC), using Knowtis as reference. Porting would drag OAuth, `AuthService`, `ApiError`, Hono, ~520 LOC and the v1 SDK. Use SDK v2 `createMcpHandler` with a server per request and `registerTool`. Never log any part of the case token | 3 |
| Eval runtime | `<eval>/runtime/eval-runtime.ts` (+ 846-line spec, a key-less promptfoo spec) | **Port with trim**: `runEvalSuite`, `summarizeTrials`, `toTrialResult`, `caseKeyOf`. Key cases by `case_id` + provider so variants don't merge; read `tokenUsage` and `cost` from the provider response; take repeats and variants from flags; a missing key exits non-zero; git SHA from `git rev-parse`. Re-check the result shape against promptfoo 0.124 | 6 |
| Judgment export + agreement | `<eval>/calibration/` (`agreement.ts`, `judgment-row.ts`, `judgment-extract.ts`, CLIs; 16 tests) | **Port with trim** (~270 LOC): inline `caseKeyOf`, key rows by case and variant, first attempt only, add mutation negatives, report TPR and TNR with Wilson intervals (kappa secondary); the 7 known-bad controls are a separate gate | 6 |
| Exfiltration link scanner | `<eval>/assertions.ts` (`assertNoExfiltrationLink` and helpers, ~90 LOC + ~217 lines of bypass tests) | **Port with trim** into the validator as `LINK_IN_REPLY`: "host not in the albo allow-list" instead of "attacker host"; add raw HTML and bare-domain detection | 4 |
| Scripted model fixtures | `ai-sdk-agent.final-step.spec.ts`, `byok-key-failure.spec.ts` (inline helpers) | **Port with trim** into `test/mock-model.ts`: `MockLanguageModelV4` usage and finish shapes for ai v7, `inOrder`, a `429` with `retry-after-ms: 0`; drop the fallback-chain wiring | 4 |
| Token cost | `packages/ai-gateway/src/catalog/compute-token-cost.ts`, `turn-usage.ts` (+ tests) | **Port as is** (~95 LOC): USD per call with separate cache-read and cache-write pricing. The dated price table is new | 4 |
| JSON logger + DB error redaction | `apps/api/src/core/logging/json-console-logger.ts`, `core/errors/{reason-of,stack-of,database-diagnostics}.ts` | **Port with trim**: add `maskPii`, `authorization` header and case-token redaction in `printMessages` (the logger sink of 02 G6); drop `rewrite-database-errors.ts` and the Railway naming | 4 |
| Drizzle module, migrate CLI, unique-violation check | `apps/api/src/database/`, `drizzle.config.ts` | **Port with trim**: drop the advisory lock and lock retry from `migrate.ts` (seed is one-shot); `isUniqueViolation` backs at-most-once execution | 4 |
| HTTP exception filter | `apps/api/src/core/filters/http-exception.filter.ts` | **Port with trim**: keeps `413` and `415` from becoming `500` (the 32 KB webhook limit), hides 5xx details; drop `RetryAfterHttpException` | 7 |
| Langfuse bootstrap, record-content switch | `<api>/observability/langfuse-tracing.service.ts`, `redacted-telemetry.ts` (11 tests) | **Port with trim**, optional (cut #1): drop `EnvConfig` and `reasonOf`, **add the `mask`** Knowtis never passed | 8 |
| Stop hook | `tools/claude-stop-typecheck.mjs` (+ 24 `node:test` tests) | **Port with trim**: call `pnpm verify` instead of `nx affected`, keep the 2-block cap, update the tests that assert Nx args | 0 |
| CLAUDE.md, `.claude/rules/` | Knowtis root | **Rewrite** (~60-line CLAUDE.md, 4 rules ≈ 200 lines): the originals carry Nx, neverthrow, CASL, Yjs, Socket.IO, Railway and `@knowtis/*` content that would be debt here | 0 |
| Vitest unit / database projects, env helpers, constant-time compare, skill layout | `apps/api/vitest.config.ts`, `config/env.config.ts` (`withoutBlankValues`), `ai/model-gate-token.guard.ts`, `.agents/skills/` | **Reference only**: the shapes are reused, the code is not | 0, 4, 7 |

Not taken, on purpose: the step loop, model chain and error classification (built around streaming, fallback and BYOK; the provider error mapping here is ~20 new lines); the eval harness wired to Nest `TestingModule`; `assertInjectionNotObeyed` (checks a canary word, while ADV cases here judge the action taken); HITL, turn claims and queues (Redis-based); health and backoffice UI pieces (bring Terminus, Swagger and the design system); RRF and hybrid retrieval (dead code with 10 docs; named in DESIGN.md "with more time"); model catalog, quotas, websockets, memory, OAuth, the LLM injection classifier, the windowed scanner. Knowtis has no Testcontainers setup; that is new work.

## Time budget

| Block | First draft | Now | What the second pass added |
| --- | --- | --- | --- |
| Specs, agent setup (hooks, skills, reviewer, global setup snapshot), repo skeleton | 45 | 45 | — |
| Industry research pass and spec revision | — | 45 | Seven researchers, rulings across their reports, `docs:` commits |
| Contracts and masking | 25 | 100 | Fail-closed G6 (fold, sweep, density window, opaque tokens, id registry), decision DTO without operator, new flags, quote in citations |
| Dataset, mock core, MCP server, each in compose | 60 | 95 | Core-mock idempotency keys, registry ids and folio, MCP SDK v2, JWT claims, rate limit |
| Harness core: gate, decision, executor, validation, placeholders + deterministic tests | 90 | 365 | Fact predicates, grounding and commitment blocks, quote check, executor container with roles, trigger and outbox, operator tokens, override, check-off, canaries, first-party signal, kill switch, AI SDK budget and timeout rules, spend-limit and breaker handling |
| Policies and full-text retrieval | 30 | 60 | Accent folding and OR query, catalog in the tool, uncited `state_rules`, manifest, normalized-text scan, recall test |
| Eval runner, first run, judge calibration | 60 | 130 | ADV-07..10, 104 runs instead of 80, mutation negatives, blind labeling, TPR/TNR, intervals, high-stakes gate |
| Webhook, queue, console | 75 | 135 | Standard Webhooks, claim fencing and backoff, operator sign-in, check-off, override and canary feedback in the console |
| Traces, alerts, variant decision | 30 | 45 | Content recording off, alert table with owners |
| DESIGN, EVALS, PLAYBOOK, AI_NOTES, README, compliance appendix | 50 | 70 | Rollout ladder with exit criteria, incident runbook, REUNE mapping |

Total ≈ 18 h (first draft ≈ 7 h 45). Exceeding the brief's 6–8 h is a decision, not an overrun: the first draft met the budget by accepting eight residual risks, and the research showed that each had a control the industry already uses at a cost of minutes, not days (02 Residual risk). AI_NOTES.md records the decision. The Knowtis ports above still take ≈ 35 min off the harness and eval blocks. The cut order in 04 removes ≈ 50 min of optional work without touching any guarantee or the adversarial evals. If the harness block still overruns, that is the signal to cut, not to compress tests.

## Rubric mapping

| Criterion | Where it is answered |
| --- | --- |
| Agent and harness design (highest weight) | 01 §Pipeline, §Context policy, §Failure handling |
| Security and guardrails | 02 entire file; tests in 02 §Required tests |
| Evals and measurement | 03; EVALS.md with honest failures |
| Full stack and product | 01 §Components; console in 04 step 7 |
| Operability and costs | 01 §Observability; cost per case in traces and evals |
| Technical leadership | 00 cuts, DESIGN.md, PLAYBOOK.md |
| Collaboration with AI | `specs/`, CLAUDE.md, `.claude/`, AI_NOTES.md, unsquashed history |
