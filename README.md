# Case Copilot

An agent that investigates a customer case with read-only tools and policies, proposes a resolution, and leaves every consequential action to a human in ops. The specs in `specs/` are the design; `AGENTS.md` maps the code.

## Run it

```sh
export ANTHROPIC_API_KEY=…   # optional, see "Without a key"
docker compose up --build
```

`seed` migrates and loads the synthetic bank and the policies, then `api` (webhook, queue worker, decisions), `executor`, `mcp`, `core-mock` and `console` start. Every variable has a dev default in `.env.example`.

## The console

Open <http://localhost:5173> and sign in with a dev operator token from `OPERATOR_TOKENS` in `.env.example`:

| Operator | Token                                |
| -------- | ------------------------------------ |
| ana      | `dev-operator-ana-token-0123456789`  |
| beto     | `dev-operator-beto-token-0123456789` |

These tokens exist only for local use; set `OPERATOR_TOKENS` to your own anywhere else.

From the inbox, **Nuevo caso** opens a case through the same signed webhook path a real ticket takes. A case shows the customer's text, the agent's proposal with its citations, the trace (tools, retrieval, validator codes, cost, latency), the editable reply and the decision.

## Sample cases

```sh
pnpm install
pnpm demo:post ADV-01 ADV-06 CARD-UNREC-01   # any id in data/webhook-fixtures
CANARY_SPREAD_MS=0 pnpm canary:inject        # one practice case per planted defect
```

Both read their defaults from `.env.example` and talk to the running stack.

## Without a key

With `ANTHROPIC_API_KEY` blank, each new case fails with `no_api_key` and the console says so. With `AGENT_MODE=off` (the kill switch), each case reaches review without an investigation, as a proposal of no action with a blank reply; nothing calls a model.

## Tests

| Command       | Runs                                                        | Needs                         |
| ------------- | ----------------------------------------------------------- | ----------------------------- |
| `pnpm verify` | typecheck, lint, unit and console tests, hook tests         | nothing                       |
| `pnpm test`   | the above plus integration tests on Testcontainers Postgres | Docker, no key                |
| `pnpm e2e`    | Playwright through the console: decide, demo cases, canary  | a fresh stack, kill switch on |

Before `pnpm e2e`:

```sh
pnpm --filter @fintech-agent/e2e exec playwright install chromium
docker compose down -v && AGENT_MODE=off docker compose up -d --build --wait
```

Each run leaves undecided practice cases in the inbox, so start from empty volumes.
