@AGENTS.md

## Claude Code specifics

- Execution follows `specs/04-build-plan.md` step by step. Progress and every deviation (`Ruling:` lines) live in the git-ignored ledger `.superpowers/sdd/04-build-plan/progress.md`; after a compaction, trust the ledger and `git log` over memory.
- Subagents follow the roster in `docs/agent-setup/`: judgment-heavy work (gate, executor, validator) is never delegated blind; review the diff with `invariant-reviewer` before committing it.
- Use Context7 (`.mcp.json`) for library docs and the local read-only Postgres MCP to inspect data; never point it at anything but the compose database.
