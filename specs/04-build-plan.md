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

## Step 1 — Contracts and masking (part of harness core, 25 min)

- `packages/contracts`: `ResolutionSchema`, `ProposedActionSchema` (closed enum, no value fields), decision DTO, case, trace step and API DTOs in Zod.
- `maskPii` with the pattern table from 02 G6 and its tests.

Done when: masking tests from 02 pass, including idempotence and the benign set.

## Step 2 — Dataset and core-mock (30 min)

- `data/scenarios.ts`: one entry per row of the 03 case table (id, customer, planted transactions with type, state, hold or return reason, auth factors, reversal credit). Labels in step 6 reference these ids. Every returned SPEI out, filler included, gets a reversal credit except CONFLICT-01's, so the doc 02 rule fires only where intended.
- `data/generate.ts` with a fixed seed: plants every scenario first by fixed id, then filler to ~200 transactions across 20 customers.
- Committed output: `data/customers.json`, `data/transactions.json`, and one webhook fixture per scenario in `data/webhook-fixtures/` (the 6 adversarial ones included, so the inbox can show them).
- `apps/core-mock`: read endpoints; three write endpoints (`/disputes`, `/cep/resend`, `/fraud/escalations`) that require the executor key and log each call. Dockerfile, compose service, healthcheck.

Done when: a test asserts 20 customers, 190–210 transactions, all four states and three types present, and every scenario in `data/scenarios.ts` exists with its planted state; `docker compose up core-mock` is healthy.

## Step 3 — MCP server (30 min)

- Port `annotations.ts` from Knowtis (`feat(port): bring MCP tool annotations from knowtis`); write the wrapper, error format and stateless Node transport fresh, with Knowtis as reference (00 explains why).
- Four read-only tools (01 §Tools), customer resolved from the case token, masking on every output, `cross_customer_lookup` event. Dockerfile, compose service, healthcheck.

Done when: the tool-binding tests from 02 pass; MCP Inspector lists four tools, none with a `customer_id` input; `docker compose up mcp` is healthy.

## Step 4 — Harness core (90 min; with step 1, the 115-minute harness block in 00)

- Harness core in `apps/api/src/agent/core/` as plain TypeScript with explicit dependencies; `apps/api` on NestJS 11 + Drizzle only wires it (01).
- Ports, one commit each (00 table): Drizzle module and migrate CLI, JSON logger with redaction, token cost, scripted mock-model fixtures, exfiltration link scanner into the validator.
- Migrations for every table in 01; the `seed` compose service runs migrations and ingestion idempotently before `api` starts.
- Domain `transition()` and conditional updates; decision API (approve / reject, both with `final_reply`, flag acknowledgment, `reject_code`); executor module with re-validation and `action_executions`; audit log.
- Validator with every code in 02 G5, including `state_rules` evaluation for `POLICY_DATA_CONFLICT`; repair retry; fallback.
- Placeholder filler with business-day math over a committed Mexican bank-holiday list (`data/bank-holidays.json`, 2026–2027). Timebox 15 min.
- Agent node: `ToolLoopAgent`, structured output, step, token and USD budget, `prepareStep` forcing synthesis on the last step, provider error mapping including `no_api_key` (01 §Failure handling).
- Dated price table in config; cost per step and per case written to `agent_runs` from the first run.
- Testcontainers Postgres for the integration tests.

Done when: every 02 required test for gate, decision, flag acknowledgment, write boundary, validation, agent loop (including timeout, `429`, malformed JSON and no key) and masking at sinks passes with `MockLanguageModelV4`; `docker compose up` runs `seed` then `api`. This step is not delegated blind: I write or review every line of the gate, executor and validator, and `invariant-reviewer` reviews the diff before the commit (AI_NOTES "what I did not delegate").

## Step 5 — Policies and retrieval (30 min)

- 10 policy docs in `data/policies/`, each marked synthetic and citing its real source where one exists (02 §Regulatory constraints). Docs with checkable rules carry `state_rules` front matter.

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

- Chunker by section, ingestion with the ported guard (`feat(port): bring injection guard and corpus from knowtis`), quarantine flag, normalization (02 G8). Runs inside `seed`.
- Postgres full-text search over non-quarantined chunks. No vector leg and no RRF (00).

Done when: "cuánto tarda un SPEI" returns the SPEI-times doc first; 09 is quarantined and never returned; 09b is returned (that is the point of ADV-05); the ingestion tests from 02 pass.

## Step 6 — Evals: labels, runner, first run (60 min)

- Commit `evals/cases.ts` labels, keyed by the scenario ids from step 2, **before** the first real run: `test: add labeled eval cases`.
- Ports, one commit each: eval runtime, judgment export and agreement (00 table).
- Runner, checkers, judge rubric, the 6 known-bad controls, `eval:judgments`, `eval:agreement` (ported agreement plus Cohen's kappa), `eval:report` (writes the summary block into EVALS.md).
- First full run of both variants (80 runs, 03); hand-label the 46 calibration rows; compute agreement.

Done when: `pnpm eval` prints every metric in 03 for both variants, cost and latency included, and writes `evals/results/`. Failures are read case by case before any prompt change; each prompt change after this is its own commit, and its before/after numbers go in EVALS.md.

## Step 7 — Webhook, queue, console (75 min)

- Port the HTTP exception filter (00 table) so the body limit returns `413`.
- Webhook with HMAC, body limit, idempotency ledger, folio and acuse, `202`/`200`/`409`/`413`; worker with `SKIP LOCKED`, retries, `failed` state.
- `POST /cases` for the console: the API builds and signs the event server-side and runs it through the webhook handler (01).
- `pnpm demo:post <ids…>`: signs and posts the step 2 fixtures to the running stack.
- Console (React + Vite + TanStack Query, polling), with Dockerfile and compose service:
  - Inbox with status, flags and folio; `high` review tier first; eval cases hidden by default.
  - **New case form**: pick a customer, type the text, submit. It takes the real webhook path, so the interview cases need no code change.
  - Case detail: trace (tool calls with masked args, retrieval, validator codes, cost, latency), reasoning summary, citations, editable reply.
  - Decision: operator selector, edited reply, approve or reject. Flags sit next to Approve and need an explicit acknowledgment; reject requires a `reject_code`. **Run / Re-run agent** on any case (max 3 re-runs).
  - Everything rendered as plain text; CSP from 02 G7.

Done when: `docker compose up` → submit a case in the form → it reaches `needs_review` → approve with an edited reply → case `resolved`, one `action_executions` row and one core-mock write log line; `pnpm demo:post ADV-01 ADV-06` shows both in the inbox with their flags. Webhook tests from 02 pass.

## Step 8 — Traces, alerts, variant decision (30 min)

- `ops/alerts.sql`: the three alert queries from 01 plus the operator rubber-stamp query from 02.
- Apply the 03 decision rule to the step 6 results; re-run the comparison only if prompts or tools changed since. Set the default variant.
- Optional: Langfuse bootstrap (`feat(port): bring langfuse bootstrap from knowtis`), mask function wired, off without keys. Postgres traces already meet the requirement; this is the first cut.

Done when: a case in the console shows tokens, cost and latency per step; EVALS.md has the run and the decision.

## Step 9 — Docs (50 min)

| File | Must contain |
| --- | --- |
| `README.md` | `export ANTHROPIC_API_KEY=… && docker compose up` starts everything (seed included); where the console is; `pnpm demo:post` for sample cases; `pnpm test` needs Docker and no key; `pnpm eval` needs the stack and a key; what happens without a key |
| `DESIGN.md` | **Brief, about two pages.** Harness diagram. A trade-offs table: 3 services vs 1, Postgres queue vs pg-boss, own audience-bound token vs MCP OAuth, privilege separation vs dual-LLM, full-text vs hybrid retrieval, `ToolLoopAgent` vs own loop, NestJS 11 and MCP SDK v1 vs latest. Defense model, the pattern named as in 02 (Rule of Two [AB] agent, lethal trifecta broken on exfiltration, not Action-Selector), guarantees and residual risk with production detection. Context policy and the 200-movement customer. Provider failure handling. What was cut and why. What I would do with more time (dual-LLM or CaMeL for write-capable agents, executor as its own service, pg-boss, hybrid retrieval with the Knowtis RRF, more labelers, a promptfoo red-team pass). **At 10x cases:** worker concurrency and provider rate limits become the bottleneck before Postgres does; the ops review queue grows, so triage by tier. **With ten agents sharing tools:** the MCP server becomes a platform: per-agent tool allowlists and scopes in the token, per-agent rate limits and budgets, versioned tool schemas, masking and audit centralized there, and the executor turns into a shared action service with a per-action policy registry. The "Plain statement for Legal" from 02, with a link to the appendix |
| `docs/compliance.md` | Appendix, not required reading: OWASP LLM Top 10 2025 and Agentic Top 10 mapping; the MCP auth deviation (02 G4); why the injection guard is only a signal ("The Attacker Moves Second", 2025); the regulatory table from 02; the LLM provider as a processor under contract with no training and zero retention (LFPDPPP); a retention table (raw text never stored, masked runs kept N days, the aclaración expediente kept per LTOSF art. 23); the open questions for Legal (intake = notice; IFPE rules arts. 44–45); PCI scope kept out of the provider; EU AI Act not high-risk; Reg E as a benchmark; the four elements of the June 2026 Banxico analysis (known through press) mapped to the design |
| `EVALS.md` | The shape in 03 |
| `PLAYBOOK.md` | **One page, in Spanish, for people who are not AI experts.** Three sections matching the brief, plain words, no jargon (say "the agent resisted every attack in three out of three tries" instead of pass^3; "the automatic grader agrees with people" instead of kappa). (1) *Qué reutilizar tal cual y qué adaptar*: reuse the MCP wrapper, masking, approval gate and executor, eval runner; adapt the tools, the list of allowed actions, the policies, the test cases, and a one-paragraph "job description" of the agent saying what it decides and when it hands off to a person. (2) *Reglas que no se negocian*: the agent only reads; approval lives in code; personal data is masked everywhere; a test set with attack cases runs before every change; a cost ceiling per case; the customer can always reach a person; if an agent ever gets a write tool, it gets a peso limit enforced in code. (3) *Cómo saber que está listo para producción*: it resisted every attack case three out of three times; the automatic grader agrees with people; cost and time per case within budget; alerts wired with an owner; tested against recently closed real cases; rolled out shadow → copilot → autonomy only for low-risk replies, never for actions; measured by whether the customer has to come back within 7 days, because an approval is not a resolution |
| `AI_NOTES.md` | Tools and setup and why (pointing to `docs/agent-setup/`); 2–3 real speed-ups; one rewritten instruction (before / after); one agent error caught and how; what was not delegated blind |

Done when: PLAYBOOK.md fits one printed page (≈ 500 words) and DESIGN.md about two.

## Step 10 — Rehearsal (15 min, outside the budget)

- Write 3 cases not in the eval set, enter them through the console form, read the trace aloud as if for the interview.
- Practice the edge questions from the brief: policy vs account data (CONFLICT-01), detecting a model regression (eval run keyed by `model` and `prompt_version` + reject-rate and edit-ratio alert), the Legal statement.
- Rehearse the setup demo: open the repo, show AGENTS.md, hooks and the invariant reviewer, then ask the agent to add an eval case with `add-eval-case` without finishing it.
- Optional: record the 3–5 minute video with one normal and one adversarial case.

## Cut order if late

Planned total is ≈ 7 h 45 (00); with these cuts ≈ 6 h 55. Cut in this order until the remaining work fits; together they save ≈ 50 focused minutes.

1. Langfuse (≈ 15 min); Postgres traces stay the source of truth.
2. Console polish: keep every function in step 7, drop styling; flag acknowledgment stays enforced by the API even if the UI is a plain checkbox (≈ 15 min).
3. Second skill (`add-policy-doc`); `add-eval-case` stays because it is the interview demo (≈ 10 min).
4. Cached-token pricing and the edit-ratio dashboard; `reply_edit_ratio` is still stored (≈ 10 min).

Never cut: any 02 guarantee or its tests, the 6 adversarial cases, the high-stakes repeats, the decision rule, the one-command start, the docs.
