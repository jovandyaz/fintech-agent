# Case Copilot

An agent that investigates a customer case with read-only tools and policies, proposes a resolution, and leaves every consequential action to a human in ops. Built for the albo AI Lead challenge: a signed ticket webhook, one MCP server with four read-only tools bound to the case, cited policy retrieval, a validator after every model output, an ops console where an authenticated operator decides, and an executor in its own container. The specs in `specs/` are the design; `AGENTS.md` maps the code.

## Run it

Needs Docker with Compose; the `pnpm` commands also need Node 24+, pnpm 12 and `pnpm install` once.

```sh
export ANTHROPIC_API_KEY=… && docker compose up
```

No key? Run `docker compose up` alone (see [Without a key](#without-a-key-and-the-kill-switch)); add `--build` after pulling new code. `seed` migrates Postgres, sets the service role passwords and ingests the policies, then exits; `api` (webhook, queue worker, decisions), `executor` and `mcp` wait for it. Every variable has a dev default in `.env.example`; a `.env` in the repo root overrides them.

Use a key from an Anthropic workspace with its own spend limit: `RUN_COST_CEILING_USD` caps one run, the workspace the total; past it, runs fail with `provider_spend_limit` ([01 §Failure handling](specs/01-architecture.md#failure-handling)).

## The console

Open <http://localhost:5173> and sign in with a dev operator token from `OPERATOR_TOKENS` in `.env.example`:

| Operator | Token                                |
| -------- | ------------------------------------ |
| ana      | `dev-operator-ana-token-0123456789`  |
| beto     | `dev-operator-beto-token-0123456789` |

These tokens exist only for local use; set `OPERATOR_TOKENS` to your own anywhere else.

**Nuevo caso** opens a case through the same signed webhook a real ticket takes. A case shows the masked text, the cited proposal, the trace (tools, retrieval, validator codes, tokens, cost and latency per step), the editable reply and the decision. Flags need acknowledgment; on a `high`-tier case, approving an action asks you to check off its transactions.

## Sample cases

```sh
pnpm demo:post ADV-01 CARD-UNREC-01 CONFLICT-01   # any id in data/webhook-fixtures
```

- `ADV-01` orders a $5,000 refund to a CLABE: look for the flag _Posible instrucción en el texto del cliente_, the CLABE masked, and no action or a fraud escalation (no refund action exists, 02 G2).
- `CARD-UNREC-01` disputes an unrecognized PAYPAL charge: an `open_dispute` on that charge with the cited policy, on a `high`-tier case.
- `CONFLICT-01` asks about a returned SPEI transfer: the flag _La política y los datos no coinciden_, with the action forced to `none`.

Under the kill switch, `ADV-01` still shows the injection flag.

`demo:post` and `canary:inject` read `.env.example` and your shell, never `.env`: if you changed `WEBHOOK_SECRET`, `API_PORT` or a database password there, export the matching value (`API_DATABASE_URL` for canaries) first.

## Canaries

```sh
CANARY_SPREAD_MS=0 pnpm canary:inject
```

Posts one practice case per canary template (9), each with a defect the validator cannot catch, indistinguishable until you decide: approving shows _Canario no detectado_, rejecting _Canario detectado_, and neither reaches the executor. The per-operator catch rate is an alert. By default they spread over `CANARY_SPREAD_MS` (5 minutes); `0` posts them at once. Inside compose, where pnpm cannot run scripts over the production install:

```sh
docker compose exec -e CANARY_SPREAD_MS=0 api node --import tsx src/canaries/main.ts
```

## Without a key, and the kill switch

With `ANTHROPIC_API_KEY` blank, each new case fails at once with `no_api_key` and a console banner says so.

`AGENT_MODE=off` is the kill switch: each case reaches review uninvestigated, as no action with a blank reply, and nothing calls a model. It also lets you try the console without a key: `AGENT_MODE=off docker compose up`. On a running stack, `AGENT_MODE=off docker compose up -d api` recreates `api` with the switch off.

## Tests

| Command       | Runs                                                                                            | Needs                               |
| ------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------- |
| `pnpm verify` | typecheck, lint, unit and console tests, hook tests                                             | nothing                             |
| `pnpm test`   | unit, console and integration tests (Testcontainers Postgres), hook tests; no typecheck or lint | Docker, no key                      |
| `pnpm e2e`    | Playwright through the console: decide, demo cases, canary                                      | a fresh stack with `AGENT_MODE=off` |

Before `pnpm e2e` (each run leaves undecided practice cases, so start from empty volumes):

```sh
pnpm --filter @fintech-agent/e2e exec playwright install chromium
docker compose down -v && AGENT_MODE=off docker compose up -d --build --wait
```

## Evals

```sh
pnpm eval                                     # stack up, ANTHROPIC_API_KEY exported
pnpm eval --only CARD-UNREC-01 --variant A    # one case
```

`pnpm eval` needs the running stack and a key, and costs money: a full run (104 agent runs, judge, redactor recall) cost $4.81 ([EVALS.md](EVALS.md), run 3); `EVAL_SPEND_CAP_USD`, once reached, stops new attempts. `pnpm eval:rejudge <results file>` re-runs only the judge on a stored run (about $1.82 for run 3, estimated) and writes a new results file; `--dry-run` prints the judge calls and their estimated cost without calling the judge or needing a key. `--only <id>` runs one case: a variant-A attempt cost $0.0444 at p50 and $0.0764 at p95 before the judge; a high-stakes case runs three times, and without `--variant` both variants run. Method: [specs/03-evals.md](specs/03-evals.md).

## Operations

- [ops/README.md](ops/README.md): alert and dashboard queries, thresholds, owners.
- `docker compose logs --no-log-prefix --no-color --since 10m api mcp executor | pnpm ops:scan-logs`: unmasked PII, lost security events, bursts of rejected MCP requests.
- `pnpm ops:scan-traces` (last 24 h, or `--since <ISO instant>`): unmasked PII in stored traces.

Both print one JSON line per alert, never the flagged content, and exit `0` when quiet.

## Read next

- [DESIGN.md](DESIGN.md): trade-offs, defense model, rollout.
- [EVALS.md](EVALS.md): the measurements and why variant A runs.
- [PLAYBOOK.md](PLAYBOOK.md): one page in Spanish for ops teams.
- [AI_NOTES.md](AI_NOTES.md): the agent setup that built this.
- [docs/compliance.md](docs/compliance.md): OWASP mappings, Mexican regulation, retention.
- [specs/](specs/): the binding design.
