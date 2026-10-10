# Task 6 — AI_NOTES.md

Read `common.md` first. Spec row: `AI_NOTES.md` in specs/04-build-plan.md §Step 9. Today the file is a dated log (139 lines, one entry per step). Shape: keep the log, but put above it the five sections the spec requires, each short and concrete:

1. **Tools and setup and why** — point to `docs/agent-setup/` (read its README: skills by phase, subagent roster, hooks) and `.claude/` (project skills `add-eval-case`, `add-policy-doc`, hooks in AGENTS.md §Hooks). Why: the mandatory per-change sequence, independent reviewers, fresh verifiers.
2. **2–3 real speed-ups** — with evidence from the log/ledger (e.g. the Knowtis ports and the time they saved per specs/00-scope.md; subagent-driven tasks; scripted mock model fixtures letting e2e run without a key). Numbers only if sourced.
3. **One rewritten instruction, before / after** — a real one: find an instruction that was rewritten after it failed (candidates: a brief or rule in the ledger/log, e.g. a `Ruling:` that changed an implementer rule such as "never `git add -N` before the gate", the per-message digit budget rule, or a brief rewritten after a review caught a gap). Quote before and after; say what went wrong.
4. **One agent error caught and how** — a real one with how it was caught (review lens, mutation, verifier), e.g. Step 8: the PII scanner read `{"otp":"123456"}` as clean (invariant reviewer BLOCK), or the canary error message that would have written "canary" into logs, or the removed G3 tests restored. Pick the clearest; say what would have shipped.
5. **What was not delegated blind** — from CLAUDE.md "Subagents follow the roster…: judgment-heavy work (gate, executor, validator) is never delegated blind", the user-only decisions (paid runs, calibration labels, design approvals), and how review gates work.

Then `## Log` as today, untouched (you may fix a factual error you find, and say so). Above-the-log part ≤ 700 words.
