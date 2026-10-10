# Task 5 — PLAYBOOK.md (Spanish)

Read `common.md` first. Spec row: `PLAYBOOK.md` in specs/04-build-plan.md §Step 9 — every item is required, in the three sections it names plus "who owns it" and "si el agente se porta mal". Audience: albo team leads who are not AI experts (specs/00-scope.md). Spanish (Mexico), plain words, "tú" or impersonal, no anglicisms when a Spanish word exists.

## Hard rules

- One printed page: ≈ 500 words, hard max 560 (`wc -w`).
- No jargon: never write pass^3, TPR, TNR, kappa, MCP, token, prompt, LLM, embedding, guardrail, eval. Say "el agente resistió cada ataque en tres de tres intentos", "el calificador automático detecta los errores que detecta una persona", "la conexión de solo lectura a los sistemas", "casos de prueba". "Agente" is fine.
- Concrete, from this build: name what to reuse as things a lead recognizes (the read-only connection to the core, the masking of personal data, the approval step, the separate service that executes, the test runner), and the numbers that make "listo para producción" checkable (exit criteria from specs/04 §Step 9 DESIGN row: ≥ 200 decisiones, ≥ 90 % aprobadas sin edición fuerte, ningún caso de dinero perdido en 4 semanas, recontacto a 7 días no peor que el humano).
- The "job description" item: one paragraph example for this agent (what it decides, when it hands off), from specs/00 and specs/02 Plain statement for Legal.
- No links except at most one line at the end pointing to DESIGN.md for the technical detail.
