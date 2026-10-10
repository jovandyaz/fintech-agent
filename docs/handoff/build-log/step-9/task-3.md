# Task 3 — DESIGN.md

Read `common.md` first. Spec row: `DESIGN.md` in specs/04-build-plan.md §Step 9 — every item in it is required. This is the highest-weight doc (specs/00-scope.md: "Agent and harness design (highest weight)"). About two pages: target ≈ 1,400 words including tables, hard max 1,700. Depth lives in specs; link to the section (`specs/02-security.md#…` or "02 G3").

## Sources by item

- Harness diagram: one Mermaid `flowchart` from specs/01 §Pipeline (webhook → intake/ack → queue → worker: redaction, injection scan, retrieval, `ToolLoopAgent` with MCP read tools → validator (repair once) → Persist → console decision → executor → core-mock), marking the trust boundaries (case token, executor key, roles).
- Trade-offs table (rows exactly as the spec lists, columns: choice · alternative · why · cost of being wrong): sources specs/00-scope.md (cut list), specs/01, specs/02, ledger `Ruling:` lines.
- Defense model: name the pattern as 02 names it (Rule of Two [AB] agent, lethal trifecta broken on exfiltration, not Action-Selector); guarantees G1–G8 in one short table (guarantee · enforced by · test); residual risk with production detection (02 §Residual risk, ops alerts in specs/01 §Observability). Include the residual canary tells (ledger Step 8 Task 6 `Rulings:` line: canaries never fall back, always 3 MCP calls, 3 of 4 `none` canaries carry `action_fact_mismatch`, texts repeat per template across batches, a repaired canary's answers differ by one figure) and scanner limits (ledger Step 8 Task 4).
- Context policy and the 200-movement customer; provider failure handling: specs/01.
- What was cut and why: specs/00-scope.md table; the Knowtis ports list (00 "listed in AI_NOTES.md and DESIGN.md": the `port` commits — `git log --oneline --grep="(port)"` — and 00's "Not taken, on purpose").
- With more time: the spec's list verbatim in substance; add "wire the OTel seam to an exporter once a provider exists" (ledger last Owner line).
- Rollout, exit criteria, brief pains → metrics, 10x, ten agents: the spec row's own text; tie each metric to where it is measured (`ops/metrics.sql`, `ops/alerts.sql`, EVALS.md).
- Variant decision and eval headline: one or two lines with numbers from EVALS.md, link to it.
- End with the "Plain statement for Legal" from specs/02 (verbatim) and a link to `docs/compliance.md`.
