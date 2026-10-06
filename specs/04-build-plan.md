# 04 — Build plan

Steps run in this order: security and evals land before breadth and UI (00). Each step ends green on `pnpm verify` (typecheck, lint, unit tests; no key, no Docker) and `pnpm test` (adds the Postgres-backed tests through Testcontainers; needs Docker, no key), and in at least one commit. Commits are single-line Conventional Commits; ports use the `port` scope; history is never squashed.

Every service lands in `docker-compose.yml` with a Dockerfile and a healthcheck in the step that creates it, so `docker compose up` works at the end of every step, not only at the end.

Before coding each step, re-check the APIs it uses against the installed version (Context7 or the official docs listed in 01). Any spec change after coding starts is its own `docs:` commit with the reason.

Keep `AI_NOTES.md` as a running log from step 0: write each moment (speed-up, rewritten instruction, caught error) when it happens, not at the end.

## Step 0 — Repo and agent setup (45 min)

- `git init` under `~/Developer/Github/fintech-agent` (personal identity). First commit is `specs/` alone.
- pnpm workspace: `apps/{api,mcp,core-mock,console}`, `packages/contracts`, `evals/`, `data/`. TypeScript strict, ESLint (including the `no-restricted-imports` rule from 02 G1), Vitest.
- `docker-compose.yml` with Postgres 16; every secret has a dev default (`${VAR:-dev-…}`), so only `ANTHROPIC_API_KEY` is required.
- Agent setup, versioned as part of the deliverable. CLAUDE.md stays short and advisory; what must always happen goes in hooks; occasional knowledge goes in skills.

  | File | Content |
  | --- | --- |
  | `AGENTS.md` | Map of ≤ 100 lines for any agent: layout, commands, the 02 invariants as "never change without a failing-then-passing test", pointers to `specs/` |
  | `CLAUDE.md` | Imports `@AGENTS.md`; only what is Claude-specific |
  | `.claude/rules/{security,testing,nestjs-backend,typescript}.md` | Rewritten for this repo using Knowtis as reference (no Nx, neverthrow, CASL or Knowtis paths), scoped by path |
  | `.claude/settings.json` | Allow-list for `pnpm` and `docker compose`; deny `Read(./.env)` and `Read(./.env.*.local)` (`.env.example` stays readable: it holds the dev defaults); hooks below |
  | Hook `PostToolUse` (Edit/Write) | Format the touched file |
  | Hook `Stop` | `pnpm verify`; exits 2 to keep the agent working, at most 2 consecutive blocks so it cannot loop (ported from Knowtis with its tests, Nx call replaced) |
  | Hook `PreToolUse` (Edit/Write) on `executor/`, `approvals/`, `mask.ts`, `validate.ts`, `mcp/` | Prints the invariant the path enforces; blocks adding `.skip` / `.only` or deleting a test in those paths (agents have commented out tests to pass a build) |
  | `.claude/skills/add-eval-case/` | Adds a scenario + labeled case + webhook fixture, runs it once |
  | `.claude/skills/add-policy-doc/` | Adds a policy doc with source and `state_rules`, re-ingests, checks retrieval |
  | `.claude/agents/invariant-reviewer.md` | Narrow reviewer: checks a diff against 02 G1–G8 and must cite a file:line for each finding |
  | `.mcp.json` | Local read-only Postgres MCP (connection string by env expansion), Context7; no secrets |
  | `docs/agent-setup/` | Sanitized snapshot of the global setup actually used: the subagent roster and its model tiering, global rules (tech debt, commits), and why. The brief asks for the setup "as it ended up", and part of it lives outside the repo |
  | `.env.example` | Every variable with its dev default; `ANTHROPIC_API_KEY` is the only empty one |

  The two skills are also the interview demo for "ask your agent for a small change".

Done when: `pnpm install && pnpm verify` passes on an empty suite, `docker compose up -d db` is healthy, and a planted `.skip` in `approvals/` is blocked by the hook.

Commits: `docs: add case copilot specs` → `chore: scaffold pnpm workspace and tooling` → `chore: add versioned agent setup`.

## Step 1 — Contracts and masking (220 min)

- `packages/contracts`: `ResolutionSchema` (citations with `quote`), `ProposedActionSchema` (closed enum, no value fields), decision DTO (no operator field; `reviewed_transaction_ids`; optional `override`), case flags (the closed set in 01), case, trace step and API DTOs in Zod.
- Identifier registry: prefixes, payload grammar (never more than 4 consecutive digits), folio generator `AC-XXXX-XXXX`.
- `maskPii` and `maskJson` per 02 G6: fold, text patterns, digit runs, opaque tokens, per-message digit budget, label echo; `maskJson` exempts only registry or UUID values under id-typed keys.
- The first version (51 tests) and the review-hardened second version (110 tests) both leaked; the second pass reproduced 7 leaks in the committed code (Arabic-Indic digits, zero-width separators, 5-5-6 and single-digit groupings, `o`/`l` confusables, BIN shown on 4-2-2-4-4, duplicated label). Each becomes a failing test before the rewrite.

Done when: every masking case in 02 §Required tests passes, including the 7 reproduced leaks, idempotence, the benign set and the 32 KB timing.

## Step 2 — Dataset and core-mock (45 min)

- `data/scenarios.ts`: one entry per row of the 03 case table (id, customer, planted transactions with type, state, hold or return reason, auth factors, decline reason, merchant descriptor and channel, reversal credit, CEP availability). Labels in step 6 reference these ids. Every returned SPEI out, filler included, gets a reversal credit except CONFLICT-01's, so the doc 02 rule fires only where intended. ADV-07 plants the injected merchant descriptor. CARD-UNREC-02 plants its three card-not-present charges within 24 h; ADV-08's real SPEI amount is not 5,000, so the customer's "$5,000" stays ungrounded; card purchases carry `auth_factors`. All ids follow the registry (02 G6).
- `data/generate.ts` with a fixed seed: plants every scenario first by fixed id, then filler to ~200 transactions across 20 customers.
- Committed output: `data/customers.json`, `data/transactions.json`, and one webhook fixture per scenario in `data/webhook-fixtures/` (the 10 adversarial ones included, so the inbox can show them).
- `apps/core-mock`: read endpoints; three write endpoints (`/disputes`, `/cep/resend`, `/fraud/escalations`) that require the executor key and an `Idempotency-Key`, store the key under a unique constraint, return the first result on a repeat, and log each call. Dockerfile, compose service, healthcheck.

Done when: a test asserts 20 customers, 190–210 transactions, all four states and three types present, every scenario in `data/scenarios.ts` exists with its planted state, and every id matches the registry; a repeated write with the same key returns the first result and logs one effect; `docker compose up core-mock` is healthy.

## Step 3 — MCP server (50 min)

- MCP SDK v2 (`@modelcontextprotocol/server` + `/node`), `createMcpHandler` with a server per request (01 version decisions; the v1 fallback and its ledger ruling apply if v2 costs more than 15 minutes).
- Port `annotations.ts` from Knowtis if it fits v2 (`feat(port): bring MCP tool annotations from knowtis`); write the wrapper and error format fresh, with Knowtis as reference (00 explains why).
- Case token verified with `jose` (02 G4 claims), `401` with `WWW-Authenticate`, 12 calls per `jti`.
- Four read-only tools (01 §Tools), customer resolved from the case token, `maskJson` on every output, `tracking_key_last4`, fixed `tools/list` order, `NOT_FOUND` with `isError: true`, `cross_customer_lookup` written through a security-event sink (in-memory in this step's tests; step 4 wires the Postgres sink with the `copilot_mcp` role). Token audience from `MCP_AUDIENCE`. Dockerfile, compose service, healthcheck.

Done when: the tool-binding tests from 02 pass; MCP Inspector lists four tools, none with a `customer_id` input; `docker compose up mcp` is healthy.

## Step 4 — Harness core (410 min)

- Harness core in `apps/api/src/agent/core/` as plain TypeScript with explicit dependencies; `apps/api` on NestJS 11 + Drizzle only wires it (01).
- Ports, one commit each (00 table): Drizzle module and migrate CLI, JSON logger with redaction, token cost, scripted mock-model fixtures, exfiltration link scanner into the validator.
- Migrations for every table in 01; the `seed` compose service runs migrations idempotently before `api`, `executor` and `mcp` start (ingestion joins it in step 5). The MCP server's Postgres security-event sink is wired here.
- `ops/alerts.sql` starts here with the canary catch-rate query the canary tests need; step 8 adds the rest.
- Migrations create the two Postgres roles, their grants and the `enforce_transition_role` trigger (02 G1).
- Domain `transition()` and conditional updates; `OperatorGuard` with hashed per-operator tokens; decision API (approve / reject, both with `final_reply` checked like a draft, flag acknowledgment, `reject_code`, `reviewed_transaction_ids` on `high` tier, `override` within the G2 table); `pnpm canary:inject` and the canary transitions; audit log with key id, IP and user agent.
- Executor service: `apps/api/src/executor/main.ts`, outbox drain with `SKIP LOCKED`, `started` row, re-validation, core-mock call with `Idempotency-Key`, sweeper; compose service; `api` refuses to boot with `CORE_EXECUTOR_KEY`.
- Validator with every code in 02 G5: fact predicates (`ACTION_UNSUPPORTED`), quote check, `UNGROUNDED_NUMBER`, `COMMITMENT_IN_REPLY` and the two commitment placeholders, `PII_IN_REPLY` as a diff, `state_rules` of every matching chunk for `POLICY_DATA_CONFLICT`; `action_fact_mismatch` and `first_party_signal` at Persist; repair retry; fallback.
- Placeholder filler with business-day math over a committed Mexican bank-holiday list (`data/bank-holidays.json`, 2026–2027). Timebox 15 min.
- Redactor in the Intake node (02 G6 Step 7): `REDACTOR_MODEL`, structured spans, exact replacement, `maskPii` again, `text_redacted`, degraded path. Timebox 45 min.
- Agent node: `ToolLoopAgent`, structured output, `stopWhen` with step count and a budget condition, `timeout` object, `activeTools: []` on the last step, budget stop to fallback, repair as an appended turn, `AGENT_MODE` kill switch, provider error mapping including `no_api_key` and `provider_spend_limit`, worker circuit breaker (01 §Failure handling). Telemetry with content recording off.
- Dated price table in config; cost per step and per case written to `agent_runs` from the first run.
- Testcontainers Postgres for the integration tests.

Done when: every 02 required test for gate, operator identity, override and forcing function, canaries, executor, process boundary, decision, flag acknowledgment, validation, agent loop (including timeout, `429`, spend limit, breaker, malformed JSON, no key and kill switch) and masking at sinks passes with `MockLanguageModelV4`; `docker compose up` runs `seed`, then `api` and `executor`. This step is not delegated blind: I write or review every line of the gate, executor and validator, and `invariant-reviewer` reviews the diff before the commit (AI_NOTES "what I did not delegate").

## Step 5 — Policies and retrieval (60 min)

- 10 policy docs in `data/policies/`, each marked synthetic and citing its real source where one exists (02 §Regulatory constraints). Docs with checkable rules carry `state_rules` front matter. `data/policies/manifest.json` with id, title, `keywords` and `sha256` per doc.

  | Doc | Content | Source of the numbers |
  | --- | --- | --- |
  | 01 Tiempos SPEI | Transmission, credit, return timings; holds are exceptions | Circ. 14/2017 |
  | 02 Devoluciones SPEI y CEP | Return causes, notice to the customer, returned amount credited back the same day (`state_rules`, used by CONFLICT-01), CEP only after settlement, kept ≥ 3 months | Circ. 14/2017; same-day credit-back is synthetic |
  | 03 Aclaraciones | 90 days to file, acuse, 45-day dictamen, expediente, CONDUSEF, UNE in 30 business days | LTOSF art. 23, LPDUSF art. 50 Bis |
  | 04 Cargos no reconocidos y contracargos | Credit by 2nd business day unless two factors proven; no extra steps; how a chargeback with the card network proceeds after the aclaración | Circ. 12/2018, 18.a; chargeback steps synthetic |
  | 05 Rechazos de tarjeta | Decline reason codes and what the customer can do | Synthetic |
  | 06 Fraude y bloqueo | When a card is blocked, when to escalate | Synthetic |
  | 07 Límites por nivel de cuenta | Limits per KYC level, incoming SPEI rejected over limit | Synthetic |
  | 08 Seguridad y privacidad | Never ask for NIP/CVV/OTP; only the account holder's data | IFPE rules art. 18 fr. III |
  | 09 Aclaraciones (anexo) | Poisoned, obvious hidden instruction — must be quarantined | — |
  | 09b Rechazos (anexo) | Poisoned, subtle rule that passes the scan — contained by G2/G5 | — |

- `seed` gains ingestion. Chunker by section, ingestion with the ported guard (`feat(port): bring injection guard and corpus from knowtis`), manifest check, scan on raw and normalized text, quarantine on Unicode Tags, bidi controls or HTML comments (02 G8). Runs inside `seed`.
- Full-text search per 01 §Retrieval: `es_unaccent` config, OR query of lexemes, `ts_rank_cd`, weighted heading and keywords, optional `doc_id` filter, catalog in the tool description. No vector leg and no RRF (00).
- `retrieval.spec.ts` (Testcontainers): 25 Spanish paraphrases of customer complaints, each with its expected `doc_id`.

Done when: recall@4 ≥ 0.9 on the paraphrases, "cuánto tarda un SPEI en llegar" returns the SPEI-times doc first and "devolucion" finds "devolución"; 09 is quarantined and never returned; 09b is returned (that is the point of ADV-05); the ingestion tests from 02 pass.

## Step 6 — Evals: labels, runner, first run (130 min)

- Commit `evals/cases.ts` labels, keyed by the scenario ids from step 2, **before** the first real run: `test: add labeled eval cases`.
- Ports, one commit each: eval runtime, judgment export and agreement (00 table).
- Runner (one `evaluate()`, per-test repeat, cache off), checkers, judge rubric committed before labeling, the 7 known-bad controls, `eval:judgments` (with the mutation negatives), `eval:agreement` (TPR and TNR with Wilson intervals, kappa secondary), `eval:report` (writes the summary block into EVALS.md, with intervals, McNemar pairs and the attack-success upper bound), `evals/baseline.json` for the high-stakes gate.
- `evals/redactor-cases.ts`: 20 strings the deterministic masker misses by construction, each with its secret span; the runner reports redactor recall and over-redaction (03).
- First full run of both variants (104 runs, 03); hand-label the ~62 calibration rows blind; compute agreement.

Done when: `pnpm eval` prints every metric in 03 for both variants, cost and latency included, and writes `evals/results/`. Failures are read case by case before any prompt change; each prompt change after this is its own commit, and its before/after numbers go in EVALS.md.

## Step 7 — Webhook, queue, console (135 min)

- Port the HTTP exception filter (00 table) so the body limit returns `413`.
- Webhook with Standard Webhooks verification on the raw body (±5 min, rotation), body limit, idempotency ledger, folio and acuse, `202`/`200`/`401`/`409`/`413`; worker with `SKIP LOCKED`, `claim_token` fencing, backoff with jitter, `failed` state.
- `POST /cases` for the console: the API builds and signs the event server-side and runs it through the webhook handler (01).
- `pnpm demo:post <ids…>`: signs and posts the step 2 fixtures to the running stack.
- Console (React + Vite + TanStack Query, polling), with Dockerfile and compose service:
  - Inbox with status, flags and folio; `high` review tier first; eval cases hidden by default.
  - **New case form**: pick a customer, type the text, submit. It takes the real webhook path, so the interview cases need no code change.
  - Case detail: trace (tool calls with masked args, retrieval, validator codes, cost, latency), reasoning summary, citations, editable reply.
  - Operator sign-in with a token (dev tokens in the README); no operator selector.
  - Decision: edited reply, approve or reject. Flags sit next to Approve and need an explicit acknowledgment; on `high` tier each transaction is checked off; an override picks another allowed action and transactions; the Approve button names the effect ("Abrir aclaración sobre tx_…"); reject requires a `reject_code`. After deciding a canary, the operator is told it was one. **Run / Re-run agent** on any case (max 3 re-runs). A banner shows when `AGENT_MODE=off`.
  - Everything rendered as plain text; CSP from 02 G7.

Done when: `docker compose up` → sign in → submit a case in the form → it reaches `needs_review` → approve with an edited reply → case `resolved`, one `action_executions` row written by the executor container and one core-mock write log line; `pnpm demo:post ADV-01 ADV-06` shows both in the inbox with their flags; an injected canary approved ends `canary_missed` with no write. Webhook tests from 02 pass.

## Step 8 — Traces, alerts, variant decision (45 min)

- `ops/alerts.sql`: the remaining alerts in the 01 table, each with its threshold, minimum sample and owner.
- Apply the 03 decision rule to the step 6 results; re-run the comparison only if prompts or tools changed since. Set the default variant.
- AI SDK telemetry with content recording off by default; per-step provider request id and finish reason.
- Optional: Langfuse bootstrap (`feat(port): bring langfuse bootstrap from knowtis`), mask function wired, off without keys. Postgres traces already meet the requirement; this is the first cut.

Done when: a case in the console shows tokens, cost and latency per step; EVALS.md has the run and the decision.

## Step 9 — Docs (70 min)

| File | Must contain |
| --- | --- |
| `README.md` | `export ANTHROPIC_API_KEY=… && docker compose up` starts everything (seed included); where the console is; `pnpm demo:post` for sample cases; `pnpm test` needs Docker and no key; `pnpm eval` needs the stack and a key; what happens without a key |
| `DESIGN.md` | **Brief, about two pages.** Harness diagram. A trade-offs table: 4 services vs 1, Postgres queue vs pg-boss vs a durable-execution engine, own audience-bound token vs MCP OAuth, privilege separation plus fact predicates vs dual-LLM / CaMeL, fail-closed masking vs a Luhn-gated DLP vs a per-case vault, full-text vs hybrid retrieval vs long context, `ToolLoopAgent` vs own loop, NestJS 11 vs 12. Defense model, the pattern named as in 02 (Rule of Two [AB] agent, lethal trifecta broken on exfiltration, not Action-Selector), guarantees and residual risk with production detection. Context policy and the 200-movement customer. Provider failure handling. What was cut and why. What I would do with more time (dual-LLM or CaMeL for write-capable agents; approvals signed Ed25519 and verified by core-mock; OIDC with MFA and four-eyes for any future money-moving action; a per-case token vault; a context-minimized classifier and an LLM supervisor for replies; Prompt Guard 2 at intake and ingestion; hybrid retrieval with the Knowtis RRF and policy versioning with effective dates; a judge from another model family; more labelers and held-out cases; a promptfoo red-team pass in Spanish; synthetic hourly probes; the richer review console: evidence and cited text beside the draft, inbox sorted by regulatory deadline, edit reasons). **Rollout:** shadow / backtest on closed cases → copilot (this build) → auto-send only `standard`-tier `none` replies per category with 10–20% QA sampling; actions always human. Exit criteria per category (to calibrate on shadow data): ≥ 200 decisions, ≥ 90% approved without heavy edit, no missed money-path in 4 weeks, 7-day re-contact no worse than the human baseline; `AGENT_MODE=off` rolls back. **Brief pains to metrics:** slow = time-to-decision; inconsistent = pass^3 and canary catch rate; hard to audit = `audit_log` and the trace. **At 10x cases:** human review minutes become the bottleneck before Postgres or the provider do, which is why autonomy goes first to low-risk replies; worker concurrency and provider rate limits come next; triage by tier and deadline. **With ten agents sharing tools:** the MCP server becomes a platform: per-agent tool allowlists and scopes in the token, per-agent rate limits and budgets, versioned tool schemas, masking and audit centralized there, and the executor turns into a shared action service with a per-action policy registry. The "Plain statement for Legal" from 02, with a link to the appendix |
| `docs/compliance.md` | Appendix, not required reading: OWASP LLM Top 10 2025 and Agentic Top 10 mapping; the MCP auth deviation (02 G4); why the injection guard is only a signal ("The Attacker Moves Second", 2025); the regulatory table from 02; the LLM provider as a processor under contract with no training and zero retention (LFPDPPP); a retention table (raw text never stored, masked runs kept N days, the aclaración expediente kept per LTOSF art. 23); the open questions for Legal (intake = notice; IFPE rules arts. 44–45); PCI scope kept out of the provider; EU AI Act not high-risk; Reg E as a benchmark; the four elements of the June 2026 Banxico analysis (known through press) mapped to the design; CONDUSEF REUNE fields against our schema (missing: channel, `notified_at`, resolution outcome); LFPDPPP arts. 14 and 26 fr. II; no Mexican rule found requiring disclosure of AI-drafted replies sent by a human (a negative search) |
| `EVALS.md` | The shape in 03 |
| `PLAYBOOK.md` | **One page, in Spanish, for people who are not AI experts.** Three sections matching the brief, plain words, no jargon (say "the agent resisted every attack in three out of three tries" instead of pass^3; "the automatic grader catches the mistakes people catch" instead of TPR and kappa). (1) *Qué reutilizar tal cual y qué adaptar*: reuse the MCP wrapper, masking, approval gate and executor, eval runner; adapt the tools, the list of allowed actions, the policies, the test cases, and a one-paragraph "job description" of the agent saying what it decides and when it hands off to a person. (2) *Reglas que no se negocian*: the agent only reads; approval lives in code; personal data is masked everywhere; a test set with attack cases runs before every change; a cost ceiling per case; the customer can always reach a person; if an agent ever gets a write tool, it gets a peso limit enforced in code. (3) *Cómo saber que está listo para producción*: it resisted every attack case three out of three times; the automatic grader agrees with people; cost and time per case within budget; alerts wired with an owner; tested against recently closed real cases; rolled out shadow → copilot → autonomy only for low-risk replies, never for actions; measured by whether the customer has to come back within 7 days, because an approval is not a resolution. Plus who owns it: a named owner and a weekly review; the off switch tested; "if the agent misbehaves": turn it off → review the actions executed in that period → turn the case into a test case → turn it back on only with every attack case passing; each new operator reviews the practice cases with planted errors first |
| `AI_NOTES.md` | Tools and setup and why (pointing to `docs/agent-setup/`); 2–3 real speed-ups; one rewritten instruction (before / after); one agent error caught and how; what was not delegated blind |

Done when: PLAYBOOK.md fits one printed page (≈ 500 words) and DESIGN.md about two.

## Step 10 — Rehearsal (15 min, outside the budget)

- Write 3 cases not in the eval set, enter them through the console form, read the trace aloud as if for the interview.
- Practice the edge questions from the brief: policy vs account data (CONFLICT-01), detecting a model regression (eval run keyed by `model` and `prompt_version` + reject-rate and edit-ratio alert), the Legal statement.
- Rehearse the setup demo: open the repo, show AGENTS.md, hooks and the invariant reviewer, then ask the agent to add an eval case with `add-eval-case` without finishing it.
- Optional: record the 3–5 minute video with one normal and one adversarial case.

## Cut order if late

Planned total is ≈ 20 h 55 (00); with these cuts ≈ 20 h 05. Cut in this order until the remaining work fits; together they save ≈ 50 focused minutes.

1. Langfuse (≈ 15 min); Postgres traces stay the source of truth.
2. Console polish: keep every function in step 7, drop styling; flag acknowledgment stays enforced by the API even if the UI is a plain checkbox (≈ 15 min).
3. Second skill (`add-policy-doc`); `add-eval-case` stays because it is the interview demo (≈ 10 min).
4. Cached-token pricing and the edit-ratio dashboard; `reply_edit_ratio` is still stored (≈ 10 min).

Never cut: any 02 guarantee or its tests (fact predicates, executor isolation, operator tokens, override, canaries and check-off included), the 10 adversarial cases, the high-stakes repeats, the decision rule, the one-command start, the docs.
