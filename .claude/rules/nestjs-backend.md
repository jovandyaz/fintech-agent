---
paths:
  - 'apps/api/**'
---

# NestJS backend

- Nest only wires. Domain and harness logic live in plain TypeScript with explicit dependencies (`apps/api/src/agent/core`, domain functions such as `transition()`), so they run without Nest DI in tests and in the eval runner.
- Request and response shapes are the Zod schemas in `packages/contracts`; validate with them in a pipe. No class-validator.
- One module per area (`webhooks`, `cases`, `agent`, `retrieval`, `approvals`, `executor`). The `agent` module never imports `executor` (G1, enforced by ESLint).
- Errors: throw Nest HTTP exceptions at the edge only; the global filter maps them and hides details on 5xx. Domain code returns typed results or throws domain errors the edge translates.
- Database access through Drizzle's query builder, in domain functions that take the `Database` as a dependency (no repository layer until a query is shared by two of them); migrations are generated and committed, and the `seed` service applies them.
- Config is read once from env, validated with Zod, with dev defaults; a blank `ANTHROPIC_API_KEY` means "no key", which ends runs with `no_api_key`.
