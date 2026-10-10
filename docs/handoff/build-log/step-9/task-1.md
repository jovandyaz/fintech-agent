# Task 1 — Role passwords never reach the Postgres log

Read `common.md` first. Ledger owner (Step 7 G6 compose fix, Minor 2): `apps/api/src/database/roles.ts` `setRolePasswords` runs `ALTER ROLE … WITH LOGIN PASSWORD '<literal>'` through the simple protocol; a server with `log_statement = 'ddl'|'all'` logs the password on success, and any server logs it in a `STATEMENT:` line if the statement errors (`log_min_error_statement` defaults to `error`). These are dev role passwords from env, not customer PII, but 02 G6/the security rules say secrets never reach logs.

## Required

1. RED first: `apps/api/src/database/roles.int.spec.ts` (Testcontainers Postgres, same image and helpers the other `*.int.spec.ts` use — find them). Start the container with `log_statement=all` (command args), run `setRolePasswords` with distinctive passwords, read the container logs, assert no password appears. Second test: force the ALTER to error (e.g. a role that does not exist is not possible since roles come from `DB_ROLES` — find a real error path, such as running it as an owner without CREATEROLE, or a password the server rejects; if no clean error path exists, cover the error case by asserting the session's `log_min_error_statement` is `panic` and `log_statement` is `none` inside the same connection) and assert no `STATEMENT:` line carries the password. Third: the roles can log in with the new passwords afterwards (behavior unchanged).
2. Fix in `roles.ts`: silence statement logging for this session only. Prefer postgres.js `connection` startup parameters (`log_statement: 'none'`, `log_min_error_statement: 'panic'`) if the installed postgres.js version supports them and the server accepts them at startup for the owner role (both are superuser-settable: check that the compose owner is a superuser, `docker-compose.yml` / `.env.example` `POSTGRES_USER`); else `SET` them at the start of the session. Check the postgres.js docs for `connection`. Update the WHY comment (it currently says the ALTER "still reaches a DDL-logging server").
3. Mutations: drop each setting in turn (each must fail a test); set them with `SET LOCAL` outside a transaction (must fail).

## Files

`apps/api/src/database/roles.ts`, `apps/api/src/database/roles.int.spec.ts`. Run that spec and `apps/api/src/database/migrate.int.spec.ts` on Node 24.
