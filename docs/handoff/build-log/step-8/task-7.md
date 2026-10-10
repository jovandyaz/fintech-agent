# Task 7 — Project skills `add-eval-case` and `add-policy-doc`

Read `common.md` first. Spec: specs/04-build-plan.md §Step 0 table rows for `.claude/skills/add-eval-case/` ("Adds a scenario + labeled case + webhook fixture, runs it once") and `.claude/skills/add-policy-doc/` ("Adds a policy doc with source and `state_rules`, re-ingests, checks retrieval"); §Step 10 (the interview demo: "ask the agent to add an eval case with `add-eval-case` without finishing it"); 03 (labeled set shape), 02 G8 (ingestion quarantines flagged chunks, strips hidden content). Claude Code skill format: `SKILL.md` with YAML frontmatter `name`, `description` (when to use, third person, specific triggers); check the current format in the Claude Code docs (Context7 or docs.claude.com) before writing.

## Learn the real flow first (read, don't guess)

- Eval case: `data/scenarios.ts` (scenario ids, customers, planted transactions, how `SCENARIO_IDS` is built), `data/generate.ts` / `write-dataset.ts` (is the dataset regenerated? which command), `data/webhook-fixtures/*.json` (shape, how ids map), `evals/cases.ts` (label fields: category, action, transaction ids, `must_call`, `must_cite_doc`, `may_cite_doc`, `abstain`, `must_mention`, `high_stakes`, `success_if`, rationale), the specs that pin these (`data/dataset.spec.ts`, `evals/cases.spec.ts` or equivalent), `pnpm eval` flags (`evals/suite.ts`, `evals/run.ts`: `--only`, `--variant`), `pnpm demo:post`.
- Policy doc: `data/policies/*.md` (front matter: source, `state_rules`, sections), the ingestion command and code (`policies_ingested` log event; find the CLI), quarantine rules (G8), the retrieval recall spec from Step 5 (paraphrase recall@4).

## Required

1. `.claude/skills/add-eval-case/SKILL.md`: numbered steps with exact files and commands: pick the next id in its family; add the scenario (transactions owned by the customer, registry-shaped ids); add the label with a one-line rationale; add the webhook fixture; run the dataset/label specs and `pnpm verify`; then **stop and ask the user to approve the spend** before `pnpm eval --only <id> --variant A` (a paid call; say roughly what one run costs from EVALS.md); read the result case by case; never edit a label to make a run pass (03). Include the AGENTS.md sequence and commit subject `test: add <ID> eval case`.
2. `.claude/skills/add-policy-doc/SKILL.md`: add the doc with source and `state_rules`; re-ingest with the real command; check that a paraphrase query returns it in the top 4 (the Step 5 recall check — name the spec/command); check the quarantine still holds (a doc with hidden instructions is quarantined, G8); run `pnpm verify`; commit subject `feat(data): add <slug> policy`.
3. Dry-run both skills' non-paid steps for real on a throwaway scenario and doc, confirm the commands work, then revert those throwaway edits completely (`git status` must show only the two SKILL.md files, plus any doc edits below). Report the commands you ran and their result lines.
4. If AGENTS.md or `docs/agent-setup/README.md` lists skills, add the two; keep AGENTS.md ≤ 100 lines.

## Files

`.claude/skills/add-eval-case/SKILL.md`, `.claude/skills/add-policy-doc/SKILL.md`, optionally `AGENTS.md`, `docs/agent-setup/README.md`. No code changes; if a skill needs a missing command, report it instead of adding one.
