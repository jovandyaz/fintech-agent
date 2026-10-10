# Task 1 — Test reliability

Read `common.md` first.

## Problem 1: console specs flake under GC

`apps/console/src/test/harness.tsx` answers each fake fetch with `route.clone()` (or `route(body)` then `.clone()`). `apps/console/src/cases/NewCase.spec.tsx:10-17` (`CUSTOMERS`, `OPENED`, and `answers = [unavailable(), CUSTOMERS]` near :138) and `apps/console/src/cases/Rerun.spec.tsx:28` (`queued`) build one `Response` at module level and reuse it across tests. Node's undici registers a FinalizationRegistry on clones: when an unread clone is garbage collected it cancels the stream, which leaves the shared original "already consumed". Reproduced outside the repo:

```js
const shared = Response.json([{ id: 'cus_01' }]);
(() => {
  shared.clone();
})();
globalThis.gc();
await new Promise((r) => setTimeout(r, 20));
shared.clone(); // TypeError: Response.clone: Body has already been consumed.
```

In the full `pnpm verify` run this surfaced as 6 NewCase tests failing with "No pudimos cargar los clientes" (the customers query errored), while the file passes alone.

### Required

1. RED first: a harness spec (`apps/console/src/test/harness.spec.tsx`, create if absent) proving that `renderWithApi` refuses a route whose `Response` was already used: given a `Response` with `bodyUsed === true` as a route value, the fake fetch rejects (or `renderWithApi` throws) with an error naming the route key (e.g. `GET /customers`). This makes the failure loud instead of a misleading UI error.
2. Change every module-level shared `Response` in console specs to a factory (`const customers = () => Response.json([...])`) and pass the factory (routes already accept `(body) => Response | Promise<Response>`). Grep all `apps/console/src/**/*.spec.tsx` for module-level `Response.json(` / `new Response(` reused across tests, not only these two files.
3. The harness may keep `.clone()` for a `Response` value (single use per test is fine), but the guard above must exist.

Verification: `fnm exec --using=24 -- pnpm test:unit` three times in a row, all green; report the three result lines.

## Problem 2: Testcontainers port wait

Ledger (Step 4c): one integration run failed on a Testcontainers port-binding timeout (10 s) with nine suites starting Postgres in parallel; a retry passed. `apps/api/test/database.ts:21` starts `new PostgreSqlContainer(IMAGE).start()` while hooks allow `CONTAINER_START_MS = 120_000`.

### Required

Check the installed `testcontainers` / `@testcontainers/postgresql` versions and their docs for the startup/port wait timeout. Apply `.withStartupTimeout(CONTAINER_START_MS)` (or the correct API) so the container wait matches the hook budget. If no API controls the port-binding wait, instead cap integration workers in `vitest.config.ts` (integration project `maxWorkers`) and explain. No test can deterministically reproduce this; say so and run `fnm exec --using=24 -- pnpm vitest run --project integration apps/api/test` once (report the result line).

## Files

`apps/console/src/test/harness.tsx`, `apps/console/src/test/harness.spec.tsx`, console `*.spec.tsx` files that share a `Response`, `apps/api/test/database.ts` (and `vitest.config.ts` only if needed).

## Mutations to run

Remove the `bodyUsed` guard → harness spec fails. Revert one factory to a shared `Response` and force GC (one-off command with `NODE_OPTIONS=--expose-gc` and a `globalThis.gc?.()` in an `afterEach` you do not commit) → that spec fails; report whether you could reproduce.
