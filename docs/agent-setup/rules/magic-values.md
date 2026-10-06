---
paths: "**/*.{js,ts,jsx,tsx,mjs,cjs,py,go,rs,java,kt,swift,rb,php,c,cc,cpp,h,hpp,cs}"
---
# Magic Values

## Default

Never inline a literal whose meaning is not self-evident at the point of use. Name it.

- **Numbers** — thresholds, limits, timeouts, sizes, multipliers, status codes: extract to a `SCREAMING_SNAKE_CASE` const whose name states the unit and role (`PROBE_TIMEOUT_MS`, `MAX_RETRIES`, `SECONDS_PER_MINUTE`). The name must answer "why this value?" or at least "what is it?".
- **Strings** — statuses, kinds, event names, config keys, routes: model closed sets as union types derived from a `const` array (`as const` + `(typeof X)[number]` — house style; never TypeScript `enum`). A string compared with `===` more than once, or shared between files, is a constant or a union member, not a literal.
- **Routes/URLs** (frontend): always `ROUTES.*` from the app's config — never a hardcoded path string in `navigate()`, `to=`, `href=`.

## Not magic (leave inline)

- `0`, `1`, `-1`, `2` in idiomatic use (indices, existence checks, halving, off-by-one).
- The **definition site** itself: a named `const`/`readonly` declaration, an `as const` catalog/config object, a Zod `.default(...)`, an env schema. Extracting a constant into another constant is churn.
- Framework-idiom inline args where the API is the name: `@Throttle({ limit: 5, ttl: 60000 })`, `.slice(0, 8)` when adjacent to a named length, test fixture values.
- One-off display strings, labels, and log messages (i18n keys govern user copy).

## Heuristics

- If a code reviewer would ask "why 3?", it needs a name.
- If changing the value requires finding every copy, it needed a single definition.
- If two files must agree on the literal, it belongs in a shared constant/type (in this workspace: `packages/shared/types` when it crosses API↔frontend).
- Prefer deriving unions from const arrays so the runtime list and the type never drift.
