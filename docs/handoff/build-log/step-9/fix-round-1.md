# Step 9 — fix round 1 (from code-quality, superpowers, invariant, spec, standards and fact-check lenses)

Read `common.md` first. Same rules: no commit/stash/reset; touch only the files named for your part.

## Part A — code (one implementer)

Files: `apps/api/src/database/roles.ts`, `apps/api/src/database/roles.int.spec.ts` → rename to `apps/api/src/database/role-passwords-log.int.spec.ts` (delete the old path).

1. Two more sampling paths still log the statement text (PG16 `check_log_duration`): add `log_transaction_sample_rate: '0'` and `log_min_duration_sample: '-1'` to the session's startup params. RED first: start the test server also with `-c log_transaction_sample_rate=1` and `-c log_min_duration_sample=0` and watch the leak tests fail before adding the params. Mutation: drop each new param → a test fails.
2. Merge the two WHY comments in roles.ts into one on the params constant (the reason: the ALTER carries the password in clear; the server builds it with `%L`; these settings keep it out of every statement log path; a non-superuser owner is refused at connect, fail-closed).
3. Delete the "lets every role log in with its new password" test (duplicate of `apps/api/test/roles.int.spec.ts`), and any helper only it used.
4. `stream.setEncoding('utf8')` before `on('data')` in the log consumer, so the `(text: string)` annotation is true.
   Run the renamed spec 3 times and `apps/api/test/roles.int.spec.ts` once (Node 24). Report RED evidence and mutations.

## Part B — docs (one implementer)

Files: `DESIGN.md`, `PLAYBOOK.md`, `docs/compliance.md`, `README.md`, `AI_NOTES.md`, new `docs/handoff/build-log/ai-notes-log.md`, `AGENTS.md`, `docs/agent-setup/README.md`.

- DESIGN.md
  - Defense model wording: use 02's vocabulary, which satisfies both specs: not a pure Action-Selector (the agent reads tool outputs freely), but its action choice is an **Action-Selector over data-derived candidates** (02 §Defense model, G2 fact predicates).
  - G6 row: add `apps/api/src/database/role-passwords-log.int.spec.ts` (role passwords never reach the Postgres log).
  - Residual risk: one clause that `ALTER ROLE` text is still visible in `pg_stat_activity` while it runs and would reach `pg_stat_statements`/pgaudit if loaded (neither is in compose). With more time: send a client-side SCRAM verifier instead of the cleartext password (as `psql \password` does).
  - Residual list intro (≈ line 65): `action_fact_mismatch` and `first_party_signal` are case flags shown to the operator, not ops alerts — reword so only real alerts (`ops/alerts.sql`) are called production detection.
  - Trim toward ≈ 1,500 words (`wc -w`): keep the 12 ports but as one compact line.
- PLAYBOOK.md: the rule "un tope de costo por caso": say there is a cost ceiling per attempt and a maximum number of attempts per case (find the attempt limits in specs/01 / `.env.example`; plain words, no variable names). Trim to ≤ 510 words.
- docs/compliance.md: line ≈22 the 30/30 block rate is from run 3 (the reported run), not the first full run (EVALS.md run history); ≈100 "no service role can update or delete `audit_log`"; ASI10 (≈39) "is run by hand before every merge (AGENTS.md); there is no CI"; ≈13 the executor is "the only caller holding `CORE_EXECUTOR_KEY`" (core-mock holds it to verify); ≈157 point the Plain statement for Legal at `../DESIGN.md#plain-statement-for-legal` instead of repeating/linking the spec copy.
- README.md: ≈67 `pnpm test` runs unit, console and integration tests plus hook tests (no typecheck or lint; root package.json `test` script).
- AGENTS.md (≤ 100 lines): Map rows for `ops/` (alert and metric SQL, on-call README), `docs/handoff/` (handoff and build log) and the top-level docs (README, DESIGN, EVALS, PLAYBOOK, AI_NOTES, `docs/compliance.md`) — one row for the docs is fine; Commands rows for `pnpm canary:inject`, `pnpm ops:scan-logs` / `pnpm ops:scan-traces`, `pnpm eval:report`; `pnpm verify` row says "typecheck, lint, unit and console tests, hook tests" (check the script).
- AI_NOTES.md: move the whole `## Log` section verbatim into new `docs/handoff/build-log/ai-notes-log.md` (title `# AI notes — build log`, one line saying it is the running log trimmed out of AI_NOTES.md in Step 9) and end AI_NOTES with a one-line pointer to it; this honors the old header's "trimmed into the final shape … step 9". Ledger reference: "`docs/handoff/build-log/progress.md`, a copy of the git-ignored ledger". Node: "Node 24, plus 22 as a compatibility check". Ports: list all 12 `port` commits compactly (`git log --oneline --grep="(port)"`), as 00 says ports are listed in AI_NOTES.md and DESIGN.md.
- docs/agent-setup/README.md ≈44: the Review row's timing to match AGENTS.md ("before it is committed", for any diff on a G1–G8 path).
  Run Prettier on every file you touched; report `wc -w` for DESIGN, PLAYBOOK, AI_NOTES and `wc -l AGENTS.md`.
