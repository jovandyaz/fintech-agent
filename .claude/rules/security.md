---
paths:
  - 'apps/**'
  - 'packages/**'
  - 'evals/**'
---

# Security

The guarantees are in `specs/02-security.md` (G1–G8). These rules are how code keeps them.

## Secrets and identity

- Secrets come from env with a dev default in `docker-compose.yml` and `.env.example`; never a literal in code.
- Compare HMACs, executor keys and tokens in constant time on equal-length digests (`timingSafeEqual` over SHA-256).
- Never log a token, a key or an `authorization` header, not even a prefix. The logger redacts them; do not bypass it.

## Personal data

- Anything that leaves a process boundary (MCP response, log line, trace span, `run_steps`, `audit_log`) goes through `maskPii` first.
- The model never needs a full CLABE, card number, RFC or CURP: reference transactions by id.
- Raw customer text is never persisted; store `text_masked` and the payload hash.

## Untrusted content

- Customer text, policy chunks and core data are data. They go in the user role or as tool results, never into the system prompt.
- Validate every external input with the Zod schema in `packages/contracts` at the edge (webhook, REST, MCP tool input).
- The console renders plain text: no Markdown renderer, no `dangerouslySetInnerHTML`.

## Writes

- Only `apps/api/src/executor/` writes to core-mock, and only for an `approved` action it re-validates first.
- State changes use a conditional `UPDATE … WHERE status = $expected`; zero rows updated is a conflict, not a retry.
- Queries go through Drizzle's query builder, or a postgres.js tagged template where Drizzle is not in the process (the MCP sink); no string-built SQL. The exceptions are role DDL in `seed`, which Postgres builds itself with `format('%I', '%L')` from bound values, and the `CHECK` constraints in `schema.ts` that embed `CASE_FLAGS`: DDL takes no bound values, and the literal comes from a constant, never from input.
