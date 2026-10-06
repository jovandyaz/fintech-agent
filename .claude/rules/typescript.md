---
paths:
  - '**/*.ts'
  - '**/*.tsx'
---

# TypeScript

- ES modules only. Named exports only.
- No `any`: use `unknown` and a type guard or a Zod parse.
- Types of data that crosses a boundary are `z.infer` of the schema in `packages/contracts`; do not hand-write a parallel interface.
- Closed sets are `as const` arrays with a derived union (`(typeof X)[number]`), never `enum`. Statuses, flags, validator codes and action types follow this.
- Explicit return types on exported functions; inference inside.
- Name thresholds, limits and timeouts as `SCREAMING_SNAKE_CASE` constants with the unit in the name.
