# AI notes

Running log, written as things happen; trimmed into the final shape the brief asks for at the end of the build (`specs/04-build-plan.md` step 9).

## Setup

Claude Code as the main agent, orchestrating subagents by role (`docs/agent-setup/`), with Context7 for library docs. The repo carries its own `AGENTS.md`, path-scoped rules and three hooks; my user-level comment and magic-value hooks run on every edit.

## Log

### 2026-10-05 — Specs before code

- **Speed-up: research in parallel.** Three subagents researched Mexican regulation, agent security and fintech case studies at the same time, each told to read the draft specs first and return only deltas with a primary source and the exact file and section to change. About 25 minutes of wall time for what would have been an afternoon of reading.
- **Speed-up: an independent audit against the brief.** A fresh-context subagent built a requirement-by-requirement matrix from the challenge PDF and found 12 partially covered requirements, 14 inconsistencies between spec files, and that "start everything in one or two commands" was not actually guaranteed: no step created Dockerfiles, ran migrations or ingested policies. A second pass on the same agent verified each fix and caught three new problems my edits had introduced.
- **The research changed the design, not just the docs.** The regulatory pass found that my label for an unrecognized-charge case (`none`, "tell the customer to open a claim") would break Banxico Circular 12/2018 rule 18.a, which forbids asking the customer for any extra step. The case now expects `open_dispute`.
- **Agent error caught.** The audit of what to port from Knowtis reported that its MCP server "logs 12 secret characters of every API key". Before filing it I read the key generator: the 24 logged characters are the designed public `keyPrefix`, stored and shown to the user. The finding was wrong because the agent assumed the public prefix was only `knowtis_mcp_`. Filed as a low-severity consistency note instead of a security bug.
- **Not delegated blind: what to port.** Two audits decided port / trim / rewrite per Knowtis file. Porting the MCP wrapper as declared would have dragged OAuth, Hono and ~520 lines; it is rewritten instead.

### 2026-10-05 — Step 0, repo and agent setup

- **Checked, not remembered.** npm `latest` for TypeScript is 7.0.2, but typescript-eslint 8.71 only supports `<6.1`, so the repo pins 6.0.3. TypeScript 6 also changed `types` to default to `[]`, which would have silently dropped `@types/node`; the base tsconfig lists it.
- **Hooks written test-first.** The Stop hook is ported from Knowtis with its 23 tests (Nx call replaced by `pnpm verify`). The guard hook that blocks `.skip`/`.only` or deleted tests on the security-critical paths is new; its 15 tests were written and seen failing before the hook existed.
