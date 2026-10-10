# Step 8 — rules every implementer follows

Repo: /Volumes/Personal/Github/fintech-agent (pnpm monorepo). Read first: AGENTS.md, the plan `.superpowers/sdd/04-build-plan/step-8-plan.md` (Global Constraints + Review Focus + your task), and the spec sections your brief names. Specs in `specs/` are binding.

- **Do not commit, stash, reset, or push.** Leave your changes in the working tree; the orchestrator commits after review. Do not touch files outside your brief's list without saying so in your report.
- **Never read `.env` or `.env.*.local`.** Every `docker compose` command uses `--env-file /dev/null`. No paid model calls; no `ANTHROPIC_API_KEY`.
- **TDD:** write the test, run it and see it fail for the right reason, implement, see it pass. After GREEN, run mutation checks: break the implementation in the ways your brief lists (and any obvious one), confirm a test fails each time, restore. Report each mutation and the test that killed it.
- **Library APIs:** check the installed version (`node_modules/<pkg>/package.json`) and its docs (Context7 MCP or official site) before using an API you have not seen in this repo.
- **Code rules:** match surrounding style. Comments only for a non-obvious WHY; JSDoc on exports. Named constants / `as const` sets instead of magic numbers or repeated strings (PreToolUse hooks block violations — fix the code, don't fight the hook). No dead code, no TODO. Strict types, no `any`.
- **Commands:** Node via `fnm exec --using=24 -- <cmd>`. Unit: `fnm exec --using=24 -- pnpm vitest run --project unit <path>`; console: `--project console`; integration (Docker running): `--project integration <path>`. Before reporting: `fnm exec --using=24 -- pnpm verify` and, if you touched SQL/integration code, the integration specs you touched. Keep command output short in your context (pipe through `tail`/`grep`).
- **Report back (≤ 300 words):** status DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT; files changed; tests added (names); RED evidence (the failure message seen); mutations run and which test killed each; verify result line; any deviation from the brief and why; open concerns.
