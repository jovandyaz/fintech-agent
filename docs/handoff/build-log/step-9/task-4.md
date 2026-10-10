# Task 4 — docs/compliance.md

Read `common.md` first. Spec row: `docs/compliance.md` in specs/04-build-plan.md §Step 9 — every item is required. It is an appendix, "not required reading": open with one line saying so and linking DESIGN.md.

## Sources

- Nearly every item already has a source in specs/02-security.md (regulatory table §Regulatory constraints the design answers, G4 MCP auth deviation, Plain statement for Legal) and specs/references.md (OWASP LLM Top 10 2025, OWASP Agentic, "The Attacker Moves Second", REUNE, Banxico, LFPDPPP, EU AI Act, PCI, IFPE, Reg E, the negative search on AI-reply disclosure). Use them; cite the reference as specs/references.md does (title + URL when it has one).
- OWASP mappings: a table per list (risk · where the design answers it · test or control). Map only to controls that exist (G1–G8, validator codes, ops alerts).
- Retention table: raw customer text never stored (specs/01, `text_masked`), masked runs kept N days (if no N is specified in specs, write the N as a proposal for Legal to confirm and say so), the aclaración expediente kept per LTOSF art. 23 as specs/02 states.
- LFPDPPP arts. 14 and 26 fr. II: specs mention them only in the build plan. Read the official text (the current LFPDPPP published in the DOF, 2025 — use WebSearch/WebFetch on diputados.gob.mx or dof.gob.mx) and quote or paraphrase each article in one line with the source URL. If you cannot reach the official text, write the line as "to confirm with Legal" — never invent the content.
- CONDUSEF REUNE fields against the schema: compare with `apps/api/src/database/schema.ts` (cases columns); the spec already names the missing ones (channel, `notified_at`, resolution outcome) — confirm against the schema.
- The four elements of the June 2026 Banxico analysis (known through press): from specs/02 and references.md only; say they are known through press.
- Open questions for Legal: intake = notice; IFPE rules arts. 44–45 (specs/02).
