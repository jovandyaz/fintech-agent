# Step 4d — Validator, flags and placeholder filler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every G5 code checked in code against what the run actually saw, the Persist flags (`action_fact_mismatch`, `first_party_signal`) computed from the same facts, and the placeholder filler with business-day math, so the agent loop (4e) only orchestrates.

**Architecture:** Plain TypeScript under `apps/api/src/agent/core/validate/` (no Nest, no DB; the first-party count is passed in). Input is a `RunEvidence` built from the tool outputs the run received (parsed with the contracts MCP schemas), the chunks it retrieved, the intake flags and whether the run produced a `cross_customer_lookup`. Output is `{ ok, resolution }`, `{ codes }` (repairable) or a `policy_data_conflict` outcome that forces `none`.

**Tech Stack:** TypeScript, Zod 4, vitest 5, Node 24.

**Spec:** specs/02-security.md G2 (table and fact predicates, `action_fact_mismatch`), G3 (`first_party_signal`), G5 (every code, placeholders, commitment placeholders), Required tests row "Output validation"; specs/01-architecture.md `policy_chunks.state_rules`, Persist (flags, tier); specs/03-evals.md (CONFLICT-01, ADV rows); specs/04-build-plan.md §Step 4 validator and placeholder-filler bullets. Ledger owners carried in: run the full validator over `CANARY_TEMPLATES`; reuse `replyViolations`/`hasPii`; link scanner only on capped drafts; Persist uses `reviewTierOf`.

## Global Constraints

- Same as Steps 4b/4c: Node 24 + 22 verify per commit, TDD with mutation checks on first-run passes, closed sets `as const`, magic values named, zero comments by default, no secret literals.
- Deterministic: a fixed `now`; business days from `data/bank-holidays.json` (2026 per the CNBV calendar; 2027 computed from the same rules, provisional).
- 02 G5: customer text is never a grounding source; a quarantined chunk is never cited nor evaluated.

## Review Focus

1. A number in the draft that appears only in the customer's text ("$5,000") → `UNGROUNDED_NUMBER`, even when the model presents it as fact.
2. `escalate_fraud` with no code-produced fraud signal → `ACTION_UNSUPPORTED`; with only customer text saying "fraude" → still unsupported.
3. `{{compromiso_abono}}` on a card purchase whose seen `auth_factors = 2` → `COMMITMENT_IN_REPLY`.
4. "no podemos hacer un reembolso" passes; "te reembolsaremos" fails; "ya reembolsamos" fails.
5. A state rule evaluated only on fields of outputs the run received: a missing tool call never yields a conflict.

---

### Task 1: Business days and the bank-holiday list

`data/bank-holidays.json` (2026 CNBV list; 2027 from the same rules, marked provisional) + `apps/api/src/agent/core/calendar.ts` (`addBusinessDays`, `businessDaysBetween`, Mexico City dates) + spec (weekends, holidays, Holy Week, year boundary).

### Task 2: Run evidence

`validate/evidence.ts`: `buildEvidence({ toolOutputs, chunks, intakeFlags, crossCustomerLookup, receivedAt, now })` → seen tx ids, seen chunk ids, rows, SPEI statuses, card authorizations (parsed with contracts schemas; unparseable outputs are ignored, never trusted).

### Task 3: Structural and provenance codes

`SCHEMA`, `CITATION_UNSEEN`, `CITATION_QUOTE_MISMATCH` (NFKC + whitespace-collapsed substring), `EVIDENCE_UNSEEN`, `NO_SUPPORT`, `ACTION_NOT_ALLOWED` (G2 shape on seen transactions).

### Task 4: Fact predicates and Persist flags

`ACTION_UNSUPPORTED` per the G2 table (card auth seen; SPEI settled past `SPEI_DISPUTE_AFTER_HOURS`; resend_cep settled + cep_available; escalate_fraud signals: hold fraud_review, decline card_blocked_fraud, ≥ 3 CNP same merchant in 24 h among seen rows, intake `injection_signal`, cross-customer lookup). `persistFlags(...)` → `action_fact_mismatch`, `first_party_signal` (auth_factors ≥ 2 on a disputed card purchase, or ≥ 3 prior disputes passed in).

### Task 5: Reply codes

`UNGROUNDED_NUMBER` (amounts, dates, percentages, durations; grounded by tool outputs and cited chunks only; placeholders exempt), `COMMITMENT_IN_REPLY` (verbs + negation window; commitment placeholder predicates), and the shared `replyViolations` (PII, LINK, AUTH).

### Task 6: State rules

`validate/state-rules.ts`: `applies_to` matching on received outputs only; derived `returned_business_days_ago`; `requires: {field, not_null}`; → `POLICY_DATA_CONFLICT` outcome forcing `none` and the flag.

### Task 7: Placeholder filler

`validate/placeholders.ts`: `{{nombre}}`, `{{folio}}`, `{{fecha_recepcion}}`, `{{fecha_limite_dictamen}}` (+45 natural days), `{{fecha_limite_abono}}` (+2 business days), `{{compromiso_dictamen}}`/`{{compromiso_abono}}` from approved wording only when the predicate holds; unknown placeholders refused. A filled reply passes `replyViolations`.

### Task 8: `validate()` and the canaries

`validate/index.ts` composing Tasks 3–6 in a fixed order; `apps/api/src/agent/validate.spec.ts` with one case per code (02 row) and the negated refusal; every `CANARY_TEMPLATES` draft passes the reply codes it can be held to.

### Close-out

Spec docs (bank-holiday list provenance, 45 natural days, any wording the code made untrue); reviewing-pr + invariant-reviewer **before** each commit of validator code; fresh verifier; AI_NOTES; ledger.
