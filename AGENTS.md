# fintech-agent — Case Copilot

An agent that investigates a customer case with read-only tools and policies, proposes a resolution, and leaves every consequential action to a human in ops. Built for the albo AI Lead challenge. Specs in `specs/` are binding; read them before changing behavior.

## Map

| Path                      | What lives there                                                               | Spec      |
| ------------------------- | ------------------------------------------------------------------------------ | --------- |
| `specs/`                  | Scope, architecture, security, evals, build plan, references                   | —         |
| `apps/api`                | NestJS 11: webhook, queue worker, harness, retrieval, decisions, executor      | 01        |
| `apps/api/src/agent/core` | Harness core, plain TypeScript, no Nest DI (the eval runner calls it directly) | 01        |
| `apps/mcp`                | MCP server, four read-only tools bound to a case token                         | 01, 02 G4 |
| `apps/core-mock`          | Synthetic core banking API; the only write endpoints, for the executor         | 01        |
| `apps/console`            | React ops console                                                              | 04 step 7 |
| `packages/contracts`      | Zod schemas and `maskPii`                                                      | 01, 02 G6 |
| `data/`                   | Seeded dataset, scenarios, policy docs, webhook fixtures                       | 03, 04    |
| `evals/`                  | promptfoo runner, labeled cases, judge calibration                             | 03        |
| `e2e/`                    | Playwright end-to-end tests of the console against the compose stack           | 04 step 7 |
| `docs/agent-setup/`       | Snapshot of the global agent setup used to build this                          | —         |

Folders appear as the build plan (`specs/04-build-plan.md`) reaches them.

## Commands

| Command                 | Runs                                                      | Needs                              |
| ----------------------- | --------------------------------------------------------- | ---------------------------------- |
| `pnpm verify`           | typecheck, lint, unit tests, hook tests                   | nothing                            |
| `pnpm test`             | unit + integration (Testcontainers Postgres) + hook tests | Docker                             |
| `docker compose up`     | the whole stack                                           | `ANTHROPIC_API_KEY` for agent runs |
| `pnpm eval`             | eval runner against the running stack                     | stack + key                        |
| `pnpm demo:post <ids…>` | signs and posts `data/webhook-fixtures` to the stack      | stack                              |
| `pnpm e2e`              | Playwright through the console: decide, demo, canary      | fresh stack with `AGENT_MODE=off`  |

## Invariants (specs/02-security.md)

Never weaken one of these without a test that fails first and the user's explicit approval.

- **G1** The agent module never imports the executor or the core-mock write client (ESLint enforces it); the executor runs in its own container with its own Postgres role and is the only holder of the executor key.
- **G2** Actions are a closed enum with no amount, account or free-text instruction field; a model's action must be supported by structured tool data (fact predicates).
- **G3** Nothing executes without an authenticated operator's decision; transitions are conditional and role-bound; the effect happens once (outbox + idempotency key); canaries never execute.
- **G4** MCP tools resolve the customer from the case token; no tool accepts `customer_id`; foreign ids return `NOT_FOUND`.
- **G5** The validator checks provenance, quotes, allowed and fact-supported actions, unsourced numbers, promises, PII, links and auth-factor requests after every model output.
- **G6** Full CLABE, card numbers, phones, RFC, CURP and auth factors never reach logs, traces or the model; any run of ≥ 8 digits is masked whatever its check digit.
- **G7** Customer text and policy content are data, never instructions; the console renders plain text only.
- **G8** Policy ingestion quarantines flagged chunks and strips hidden content.

## Working rules

- Check the official docs (website or Context7) before using a library API; versions in use are pinned in `package.json`, not in memory.
- TDD: write the test, watch it fail for the right reason, then implement.
- Every build step and every behavior change follows one sequence, in this order and with no stage skipped: `developing-feature` → `reviewing-pr` plus `invariant-reviewer` (any diff on a G1–G8 path, before it is committed) → `verifying-change` with a fresh verifier → `committing-change`. The skills are listed in `docs/agent-setup/README.md` §Skills by phase.
- A spec change is its own `docs:` commit with the reason. Ports from Knowtis use the `port` scope and come with their tests (`specs/00-scope.md`).
- Commits: one line, Conventional Commits, English, imperative. Never squash.
- No secrets in the repo. Every variable lives in `.env.example` with a dev default; only `ANTHROPIC_API_KEY` is left empty.
- No dead code, no `TODO` without a ticket.
- `PLAYBOOK.md` is written in Spanish for non-AI-experts; everything else in English.

## Hooks (`.claude/settings.json`)

- **PreToolUse** `guard-invariants.mjs`: on the protected paths of G1, G3, G4, G5, G6 it reminds the invariant, and blocks adding `skip`/`only`/`todo` or removing a test in their specs. It does not see deletions made through Bash.
- **PostToolUse** `format.mjs`: runs Prettier on the edited file.
- **Stop** `stop-verify.mjs`: runs `pnpm verify`; a failure keeps the agent working, at most two times in a row.
