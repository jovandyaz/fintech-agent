# Case Copilot

An agent that investigates a customer case with read-only tools and policies, proposes a resolution, and leaves every consequential action to a human in ops. Built for the albo AI Lead challenge: a signed ticket webhook, one MCP server with four read-only tools bound to the case, cited policy retrieval, a validator after every model output, an ops console where an authenticated operator decides, and an executor in its own container. The specs in `specs/` are the design; `AGENTS.md` maps the code.

## Quickstart

### Prerequisites

- **Docker with Compose 2.24 or later.** Docker Desktop on macOS and Windows; Docker Engine plus the `docker-compose-plugin` package on Linux ([install Docker](https://docs.docker.com/get-started/get-docker/)). `docker compose version` must answer; the old `docker-compose` v1 does not work.
- **Node 24** (`engines` in `package.json`; `.node-version` pins 24). With [fnm](https://github.com/Schniz/fnm): `fnm install 24`; with [nvm](https://github.com/nvm-sh/nvm): `nvm install 24`; or the installer from [nodejs.org](https://nodejs.org).
- **pnpm**, at the version `packageManager` pins. `corepack enable` provides it: Corepack ships with Node 24 (Node 25 and later dropped it; there, `npm install -g corepack` first). Or [install pnpm](https://pnpm.io/installation) itself; pnpm 11 and later download the pinned version on their own.

No Node? Use [Docker only](#docker-only).

### Start

From the repo root:

```sh
pnpm install
pnpm start
```

`pnpm start` checks the machine first (Node, dependencies, Docker and its daemon, Compose, the five host ports, the compose subnet) and says what to fix. Then it copies `.env.example` to `.env` if there is no `.env` (it never overwrites one), settles how the agent runs, builds and starts the stack with `docker compose up --detach --build --wait`, posts the [sample cases](#sample-cases), and ends with the console URL, the sign-in tokens and the agent's state read from `/api/status`. The first build takes a few minutes. Run it again after pulling new code: it rebuilds and recreates only what changed, and a stack that is already running is updated, not refused.

Without `ANTHROPIC_API_KEY` in your shell or `.env`, it asks on a terminal: paste a key (saved to the git-ignored `.env`, not shown as you paste) or continue with the [kill switch](#without-a-key-and-the-kill-switch). Where nobody can answer (CI, a pipe) it never asks and starts with the kill switch.

| Command                  | What it does                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `pnpm start --agent-off` | Starts with the kill switch, even with a key                                                          |
| `pnpm start --no-demo`   | Skips the [sample cases](#sample-cases), which it posts by default                                    |
| `pnpm start --check`     | Runs the checks only; starts nothing                                                                  |
| `pnpm start -- --help`   | The options (pnpm answers `pnpm start --help` itself)                                                 |
| `pnpm stop`              | Stops the stack and keeps its data                                                                    |
| `pnpm reset`             | Deletes the containers and the data (every case, decision and trace) after asking; `--yes` skips that |

Use a key from an Anthropic workspace with its own spend limit: `RUN_COST_CEILING_USD` caps one run, the workspace the total; past it, runs fail with `provider_spend_limit` ([01 §Failure handling](specs/01-architecture.md#failure-handling)).

### Docker only

Without Node, compose alone runs the same stack:

```sh
ANTHROPIC_API_KEY=… docker compose up --build    # or AGENT_MODE=off docker compose up --build
```

`seed` migrates Postgres, sets the service role passwords and ingests the policies, then exits; `api` (webhook, queue worker, decisions), `executor` and `mcp` wait for it. Every variable has a dev default in `.env.example`; a `.env` in the repo root overrides them.

### Troubleshooting

- **A port is in use.** `pnpm start` names the port and the variable that moves it (`CONSOLE_PORT`, `API_PORT`, `CORE_MOCK_PORT`, `MCP_PORT`, `POSTGRES_PORT`): set it in `.env`. A port this same stack holds is fine; it is already running. `pnpm demo:post`, `pnpm canary:inject` and `pnpm e2e` read `.env.example` and your shell, not `.env`: export the same value for them.
- **The subnet overlaps** (compose says _Pool overlaps with other one on this network_). Compose pins the network to `COMPOSE_SUBNET` (10.231.0.0/24) so the console gets the fixed `CONSOLE_IP` the api trusts. When another Docker network holds that range, `pnpm start` prints a free layout to put in `.env`; set all three: `COMPOSE_SUBNET`, `COMPOSE_IP_RANGE` (its upper half) and `CONSOLE_IP` (in the lower half). The check sees Docker networks only; a VPN route over the range needs the same change by hand.
- **The banner says _El agente está apagado_.** That is the kill switch, `AGENT_MODE=off`: from `--agent-off`, your choice at the prompt, no key and no terminal, or `AGENT_MODE=off` set in `.env` or your shell. To turn the agent back on, drop that setting (or set `AGENT_MODE=on`) and run `pnpm start` with a key and without `--agent-off`.
- **The banner says _El agente no tiene clave de API_, or runs fail with `no_api_key`.** The agent is on but `ANTHROPIC_API_KEY` is empty, as after a bare `docker compose up`. Put the key in `.env` and run `pnpm start`.
- **The console misbehaves after a redeploy.** A tab opened before it runs the old bundle against the new api: hard-reload it once (Ctrl+Shift+R; Cmd+Shift+R on macOS).
- **Docker's daemon does not answer.** Start Docker Desktop and wait until it reports it is running; on Linux, `sudo systemctl start docker` and [use Docker as a non-root user](https://docs.docker.com/engine/install/linux-postinstall/).
- **`pnpm start` fails with `ERR_UNKNOWN_FILE_EXTENSION`.** Node is too old to run TypeScript files directly, so the script cannot even check it; install Node 24.

## The console

Open the URL `pnpm start` prints (<http://localhost:5173> by default) and sign in with a dev operator token from `OPERATOR_TOKENS` in `.env.example`:

| Operator | Token                                |
| -------- | ------------------------------------ |
| ana      | `dev-operator-ana-token-0123456789`  |
| beto     | `dev-operator-beto-token-0123456789` |

These tokens exist only for local use; set `OPERATOR_TOKENS` to your own anywhere else (`pnpm start` then stops printing them).

**Nuevo caso** opens a case through the same signed webhook a real ticket takes. To write one of your own, [data/CUSTOMERS.md](data/CUSTOMERS.md) lists each customer with their movements. A case shows the masked text, the cited proposal, the trace (tools, retrieval, validator codes, tokens, cost and latency per step), the editable reply and the decision. Flags need acknowledgment; on a `high`-tier case, approving an action asks you to check off its transactions.

## Sample cases

```sh
pnpm demo:post ADV-01 CARD-UNREC-01 CONFLICT-01   # any id in data/webhook-fixtures
```

`pnpm start` posts these three once the stack is up (with a key, the agent investigates them, about $0.01 in all on variant B); posting them again opens nothing new.

- `ADV-01` orders a $5,000 refund to a CLABE: look for the flag _Posible instrucción en el texto del cliente_, the CLABE masked, and no action or a fraud escalation (no refund action exists, 02 G2).
- `CARD-UNREC-01` disputes an unrecognized PAYPAL charge: an `open_dispute` on that charge with the cited policy, on a `high`-tier case.
- `CONFLICT-01` asks about a returned SPEI transfer: the flag _La política y los datos no coinciden_, with the action forced to `none`.

Under the kill switch, `ADV-01` still shows the injection flag.

The data is synthetic and frozen on Monday 2026-10-05 at 15:00, so the stack runs on its clock (`CASE_CLOCK=dataset`): each day, the first case you open is received then, and later ones by the time elapsed since. "Ayer" in a new case means Sunday 2026-10-04, as the data has it. `CASE_CLOCK=wall` in `.env` uses the real time instead.

`demo:post` and `canary:inject` read `.env.example` and your shell, never `.env`: if you changed `WEBHOOK_SECRET`, `API_PORT` or a database password there, export the matching value (`API_DATABASE_URL` for canaries) first. `pnpm start` passes your `.env`'s `API_PORT` and `WEBHOOK_SECRET` itself.

## Canaries

```sh
CANARY_SPREAD_MS=0 pnpm canary:inject
```

Posts one practice case per canary template (9), each with a defect the validator cannot catch, indistinguishable until you decide: approving shows _Canario no detectado_, rejecting _Canario detectado_, and neither reaches the executor. The per-operator catch rate is an alert. By default they spread over `CANARY_SPREAD_MS` (5 minutes); `0` posts them at once. Inside compose, where pnpm cannot run scripts over the production install:

```sh
docker compose exec -e CANARY_SPREAD_MS=0 api node --import tsx src/canaries/main.ts
```

## Without a key, and the kill switch

With `ANTHROPIC_API_KEY` blank and the agent on, each new case fails at once with `no_api_key` and a console banner says so.

`AGENT_MODE=off` is the kill switch: each case reaches review uninvestigated, as no action with a blank reply, and nothing calls a model. It also lets you try the console without a key: `pnpm start --agent-off`, or `AGENT_MODE=off docker compose up`. On a running stack, `AGENT_MODE=off docker compose up -d api` recreates `api` with the switch off.

## Tests

| Command             | Runs                                                                                            | Needs                               |
| ------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------- |
| `pnpm verify`       | typecheck, lint, unit and console tests, hook tests                                             | nothing                             |
| `pnpm test`         | unit, console and integration tests (Testcontainers Postgres), hook tests; no typecheck or lint | Docker, no key                      |
| `pnpm e2e:isolated` | the Playwright tests below on a throwaway stack, leaving your data alone                        | Docker, no key                      |
| `pnpm e2e`          | Playwright through the console: decide, demo cases, canary                                      | a fresh stack with `AGENT_MODE=off` |

`pnpm e2e:isolated` installs Chromium if it is missing, stops your stack if it runs (its data stays), starts the compose project `fintech-e2e` from empty volumes with the kill switch on, no key and no `.env`, runs `pnpm e2e` against it, then deletes that project with its volumes and images and starts your stack again, also when a test fails or you press Ctrl+C. It uses the same host ports as your stack, which is why yours stops meanwhile.

`pnpm e2e` alone runs against whatever stack is up, and each run leaves undecided practice cases, so start from empty volumes:

```sh
pnpm --filter @fintech-agent/e2e exec playwright install chromium
docker compose down -v && AGENT_MODE=off docker compose up -d --build --wait
```

## Evals

```sh
pnpm eval                                     # stack up, ANTHROPIC_API_KEY exported
pnpm eval --only CARD-UNREC-01 --variant B    # one case
```

`pnpm eval` needs the running stack and a key, and costs money: a full run (104 agent runs, judge, redactor recall) cost $5.40 ([EVALS.md](EVALS.md), run 6); `EVAL_SPEND_CAP_USD`, once reached, stops new attempts. `pnpm eval:rejudge <results file>` re-runs only the judge on a stored run (about $1.82 for run 3, estimated) and writes a new results file; `--dry-run` prints the judge calls and their estimated cost without calling the judge or needing a key. `--only <id>` runs one case: an attempt of variant B, the default, cost $0.0029 at p50 and $0.0053 at p95 before the judge (variant A: $0.0466 and $0.0792), and the judge about $0.023 per judged attempt; a high-stakes case runs three times, and without `--variant` both variants run. Method: [specs/03-evals.md](specs/03-evals.md).

## Operations

- [ops/README.md](ops/README.md): alert and dashboard queries, thresholds, owners.
- `docker compose logs --no-log-prefix --no-color --since 10m api mcp executor | pnpm ops:scan-logs`: unmasked PII, lost security events, bursts of rejected MCP requests.
- `pnpm ops:scan-traces` (last 24 h, or `--since <ISO instant>`): unmasked PII in stored traces.

Both print one JSON line per alert, never the flagged content, and exit `0` when quiet.

## Read next

- [DESIGN.md](DESIGN.md): trade-offs, defense model, rollout.
- [EVALS.md](EVALS.md): the measurements and why variant B runs.
- [PLAYBOOK.md](PLAYBOOK.md): one page for teams that want to reuse the pattern, written for people who are not AI experts.
- [AI_NOTES.md](AI_NOTES.md): the agent setup that built this.
- [docs/compliance.md](docs/compliance.md): OWASP mappings, Mexican regulation, retention.
- [specs/](specs/): the binding design.
