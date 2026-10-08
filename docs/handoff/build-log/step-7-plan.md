# Step 7 — Webhook, queue, console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A case enters through a signed webhook or the console's form, is investigated by the worker, and is decided by a signed-in operator in a React console that renders everything as plain text and gives canaries away nowhere; the first end-to-end run through the UI is reviewed in a real browser.

**Architecture:** `api` gains a ported global exception filter, the raw-body Standard Webhooks endpoint (hand-rolled HMAC check, 01 allows it), `POST /cases` that signs server-side and calls the same intake, and a read API for the console (`GET /me`, `/status`, `/customers`, `/cases`, `/cases/:id`) behind `OperatorGuard`, with DTOs in `packages/contracts`. `apps/console` is React + Vite + TanStack Query (polling), built to static files and served by a container that sets the 02 G7 CSP and proxies `/api` to `api`, so the browser only ever talks to its own origin. `pnpm demo:post` signs and posts the step 2 fixtures.

**Tech Stack:** NestJS 11 (rawBody, express body limit), node:crypto HMAC + `timingSafeEqual`, Zod 4, React 19 + Vite + TanStack Query (versions pinned after a Context7 check), nginx (static + CSP + proxy), Playwright (scripted e2e + Playwright MCP review), vitest, Testcontainers.

**Spec:** specs/04-build-plan.md §Step 7 (and its "Done when"); specs/01-architecture.md §Webhook and queue, §Components (`apps/console`), data model (inbox sort, `source = eval`); specs/02-security.md G3 (operator identity, decision rules, canaries never distinguishable, "the console tells the operator afterwards"), G6 (text_masked only, logs), G7 (plain text, CSP), T7/T8, Required tests row "Webhook"; specs/00-scope.md Knowtis row "HTTP exception filter". Ledger owners for Step 7 (progress.md lines 84, 122–123, 127, 135, 137, 294, 303, 354).

## Global Constraints

- The AGENTS.md sequence per task, no stage skipped: developing-feature → reviewing-pr + invariant-reviewer (every diff on a G1–G8 path, before the commit) → verifying-change with a fresh verifier → committing-change via `docs/handoff/commit-gate.sh`. No commit before the re-review and the verifier. No interactive commands. New files through the Write tool, never `cat >` over an existing path.
- UI review and every UI verifier use the Playwright MCP in a real browser: end-to-end flow, G7 plain text with injection/HTML/Markdown payloads, canary indistinguishability (the ledger's four points), desktop and mobile, keyboard navigation and visible focus, an accessibility check, a browser console with no errors. Screenshots outside the repo or under a git-ignored path; findings summarized in the ledger.
- No paid Anthropic call: flows use the no-key path, the kill switch, canaries, or the scripted model fixture. Any paid call: stop and ask.
- Same code rules as before: TDD with mutation checks, WHY-only comments, JSDoc on exports, named magic values, `as const` closed sets, no secret literal (every env var in `.env.example` and compose with a dev default), no dead code, commit-gate on Node 24 and 22.
- The console renders text only: no `dangerouslySetInnerHTML`, no Markdown or HTML renderer, no remote images; CSP `default-src 'self'; img-src 'self'` from the serving container.
- `is_canary`, `ticket_id`, webhook event ids and audit timestamps never appear in a console DTO.

## Review Focus

1. The same event posted twice concurrently → one case; a different body under a seen `event_id` → `409`; a new `event_id` reusing a `ticket_id` → a defined answer (ledger line 84).
2. A signature computed over parsed-and-reserialized JSON instead of the raw bytes → must fail; a body of exactly 32 KB passes, one byte more is `413`, not `500`.
3. Customer text with `<script>`, `<img src=x onerror>`, Markdown links and zero-width tricks → shown literally everywhere in the console (inbox, detail, trace, reply editor).
4. A canary next to a real case of the same scenario → no visible difference in inbox, detail, trace, timing or re-run behavior until the operator has decided.
5. An operator token that expires or is wrong mid-session → the console asks to sign in again without losing the reply being edited.

---

### Task 1: Port the HTTP exception filter (`feat(port)`)

Port `knowtis/apps/api/src/core/filters/http-exception.filter.ts` (+ spec) trimmed per 00: drop `RetryAfterHttpException`; keep `413`/`415` from becoming `500`, hide 5xx details, log 5xx masked. Register globally in `main.ts` and the test app; `rawBody: true` and a 32 KB JSON limit.

### Task 2: Webhook intake

`WEBHOOK_SECRET` (config, `.env.example`, compose; space-separated list for rotation). `webhooks/signature.ts`: `${id}.${timestamp}.${rawBody}` HMAC-SHA256, `v1,` prefixes, several signatures, ±5 min, `webhook-id` = `event_id`, `timingSafeEqual` on equal-length digests. `webhooks/intake.ts`: one transaction — `webhook_events` `ON CONFLICT DO NOTHING`, case `queued` with `folio`, `received_at`, `text_masked = maskPii(text)`, payload hash, acuse recorded as an audit row; repeat with the same hash → `200` original; different hash → `409` logged; a reused `ticket_id` under a new `event_id` → `409 ticket_conflict` (ruling). Controller `POST /webhooks/tickets` → `202 { case_id, folio }`. Tests: every 02 "Webhook" row (int, real Nest app + Testcontainers) plus Review Focus 1–2.

### Task 3: `POST /cases` and `pnpm demo:post`

`POST /cases` (OperatorGuard) `{ customer_id, text }` → the API builds the event (`evt_`/`tkt-` ids, `created_at` now), signs it with the first secret and calls the same intake with `source = console`; the secret never leaves the API. `scripts/demo-post.ts`: signs and posts `data/webhook-fixtures/<ID>.json` to `API_URL` with `WEBHOOK_SECRET` (dev defaults). Tests: the form path lands one queued case with source `console`; demo-post signs what the webhook verifies.

### Task 4: Console read API and DTOs

Contracts: `InboxItemSchema`, `CaseDetailSchema` (case, runs with masked steps, resolution, open proposal, allowed overrides), `StatusSchema` (`agent: on | off | no_api_key`), `CustomerOptionSchema` (id + first name only), `OperatorSchema`. Routes behind `OperatorGuard`: `GET /me`, `GET /status`, `GET /customers` (core read client, first names only), `GET /cases?include_eval=` (high tier first, eval hidden by default), `GET /cases/:caseId`. A test that no DTO schema carries `is_canary`, `ticket_id`, an event id or an audit timestamp, and a canary and a real case of the same scenario serialize to the same key set.

### Task 5: Canaries indistinguishable in data

Close the ledger owners: canary runs get synthesized `run_steps` shaped like a real run of their scenario (tool calls with masked args/outputs from the seeded data, retrieval of the cited chunks, a passed validation); dispute drafts carry `{{compromiso_dictamen}}`; a canary re-run shows the same `queued`/`investigating` pause a real one does (decide: delayed clone through the worker, or no observable status difference) — ruling recorded. Also (Task 4 invariant review): each canary run and clone gets its own plausible metrics (model, tokens, cost, latency) instead of the mirror's exact numbers, and a canary batch enters spread out through the same visible queued/investigating pause as a real case instead of landing at once in `needs_review`. Extend the console no-tell test to compare values across canaries and across a re-run. The comparison also covers the case text (a real case's text is the redactor's output and its trace carries `redaction` and `injection_scan` guard steps; a canary's is `maskPii(seed.text)` with no guard steps). If canaries stop copying the mirror's exact metrics, `specs/02-security.md` line 84 ("copying … tokens, cost and latency of the latest succeeded run") changes in its own `docs:` commit. G3 path: invariant review before commit.

### Task 6: Console app shell, serving container, CSP

`apps/console`: Vite + React + TanStack Query + TypeScript (lint and tests wired into the workspace), design tokens per the frontend-design brief, sign-in (token kept in session storage, re-prompt on 401 without losing the draft), polling client with the token header. Dockerfile: build, then nginx with `Content-Security-Policy: default-src 'self'; img-src 'self'` and `/api/` proxied to `api`; compose service `console` (port 5173 dev default). Tests: CSP header present; no `dangerouslySetInnerHTML` anywhere (lint rule + grep test).

### Task 7: Console screens

Inbox (status, flags, folio; high first; eval hidden toggle; empty and failed states with re-run), new case form (customer picker, text, submit through `POST /cases`), case detail (case text, trace with masked tool args, retrieval, validator codes, cost, latency; reasoning summary; citations; editable reply with `APPROVED_FACTOR_WARNINGS` insertion), decision panel (flags acknowledged next to Approve, check-off on `high`, override picker of allowed actions and the customer's transactions, Approve button naming the effect, reject requires `reject_code`, canary outcome told after deciding), Run / Re-run (max 3), `AGENT_MODE=off` and no-key banners. Component tests with plain-text assertions for Review Focus 3.

### Task 8: End to end

A scripted Playwright test against `docker compose up` (kill switch on, so a case reaches `needs_review` without a model call): sign in → new case → `needs_review` → override to `open_dispute` on the customer's transaction, edited reply, approve → `resolved`, one `action_executions` row by the executor and one core-mock write line; `pnpm demo:post ADV-01 ADV-06` shows both with their flags; an injected canary approved ends `canary_missed` with no write. Then the Playwright MCP review in a real browser per the Global Constraints, screenshots under a git-ignored path, findings in the ledger.

### Task 9: Close-out

Spec docs for anything the code made untrue, README dev tokens and console URL, AI_NOTES, ledger, handoff, push. Then Step 6.
