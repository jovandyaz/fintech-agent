# Task 4 — Log and trace scanners

Read `common.md` first. Spec: specs/01-architecture.md §Observability (alert rows "PII sink scan", `security_event_unrecorded`, `auth_rejected > 10 in 5 min`, as amended by the orchestrator's `docs(specs)` commit that precedes this task: scanners are `apps/api/src/ops/scan-logs.ts` and `scan-traces.ts`, run as `pnpm ops:scan-logs` / `pnpm ops:scan-traces`); specs/02-security.md G6 (masking rules: `maskPii` / `maskJson` in `packages/contracts`, "any run of ≥ 8 digits is masked whatever its check digit"; exempt matches are the masker's own business); 02 G4 (MCP: `auth_rejected` logs the reason only, never the token; `security_event_unrecorded`).

## Oracle

A stored or logged text is clean iff `maskPii(text) === text` (for JSON values, walk leaves the way `maskJson` does and apply the same test to each string leaf; keys under id-typed names follow `maskJson`'s exemptions — reuse `maskJson` itself: clean iff `JSON.stringify(maskJson(v)) === JSON.stringify(v)`). Verify idempotence holds for the masker's own output (`maskPii(maskPii(x)) === maskPii(x)`) with a test over a few planted PII strings; if it does not hold for some shape, stop and report NEEDS_CONTEXT (that would be a G6 finding).

## Required

1. `apps/mcp/src/app.ts:85` default logger adds `timestamp: new Date().toISOString()` to each line (the api's JsonConsoleLogger already emits `timestamp`). Test in the mcp app spec that a logged line has an ISO timestamp. This path is G4-guarded; the hook will remind you.
2. `apps/api/src/ops/scan-logs.ts`:
   - `export function scanLogLines(lines: Iterable<string>): LogAlert[]`, `LogAlert = { alert: LogAlertName; line: number; at?: string; count?: number }`, `LOG_ALERTS = ['pii_in_logs', 'security_event_unrecorded', 'auth_rejected_burst'] as const`.
   - Each line: try `JSON.parse`; on failure treat the raw line as text. `pii_in_logs` when the line (raw text, or the parsed value via the JSON oracle) is not clean. The alert never includes the line's content.
   - `security_event_unrecorded`: parsed `event === 'security_event_unrecorded'`.
   - `auth_rejected_burst`: more than 10 `auth_rejected` events whose `timestamp` falls within any 5-minute window (sliding); one alert per burst (report first line and count); lines without a parsable timestamp are counted in no window and do not crash.
   - CLI entry `apps/api/src/ops/scan-logs.main.ts` (or a `main` guarded by `import.meta.main`-equivalent used elsewhere in the repo — follow the pattern of `apps/api/src/canaries/main.ts`): reads stdin lines, prints one JSON line per alert, exit code 1 if any alert, 0 otherwise.
3. `apps/api/src/ops/scan-traces.ts`: `export async function scanStoredText(sql: Sql, since: Date): Promise<TraceAlert[]>`, `TraceAlert = { table: string; column: string; key: string }` (key = the row's primary key, never content). Columns: `run_steps.input_masked/output_masked` (rows of runs started since), `audit_log.detail_masked` (at since), `cases.text_masked/text_redacted` (received since), `resolutions.draft_reply/reasoning_summary`, `proposed_actions.justification/final_reply` (proposed since), `security_events.ref_masked` (at since). CLI `scan-traces.main.ts` reads `API_DATABASE_URL` with the `.env.example` dev default the way `apps/api/src/canaries/inject-config.ts` does, scans the last 24 h by default (`--since <iso>` optional), prints alerts as JSON lines, exit 1 if any.
4. Scripts: `apps/api/package.json` `"ops:scan-logs": "node --import tsx src/ops/scan-logs.main.ts"`, `"ops:scan-traces": …`; root `package.json` forwards them like `canary:inject`.
5. Tests (RED first):
   - `scan-logs.spec.ts` (unit): planted 8-digit run (`{"event":"tool_failed","detail":"cuenta 12345678"}`) → `pii_in_logs`; a CLABE in a non-JSON line → `pii_in_logs`, and `JSON.stringify(alerts)` does not contain the digits; one `security_event_unrecorded` line → alert; 11 `auth_rejected` within 5 minutes → one burst alert with count 11; 10 within 5 minutes → none; 11 spread over 6 minutes (no 5-minute window holds 11) → none; a clean log of api and mcp lines (masked values like `••••1234`, a folio `AC-XXXX-XXXX`, an amount `$1,299.50`, an ISO timestamp) → no alerts; a truncated JSON line does not throw.
   - `scan-traces.int.spec.ts` (Testcontainers, `apps/api/test/database.ts` helpers): a row with an unmasked 16-digit card planted in each listed column fires exactly that table/column; masked rows do not; rows older than `since` are ignored.
   - CLI exit codes: one small test per CLI (spawn with `node --import tsx` and a fixture on stdin for logs; traces may be covered by the function test plus a typecheck if spawning needs a DB — say which).
6. Mutations: drop the non-JSON fallback; window of 6 minutes; `>= 10` instead of `> 10`; skip one column in the traces scan; echo line content in the alert.

## Files

`apps/mcp/src/app.ts` (+ its spec), `apps/api/src/ops/*`, `apps/api/package.json`, `package.json`.

Run unit + `fnm exec --using=24 -- pnpm vitest run --project integration apps/api/src/ops`, then `pnpm verify`.
