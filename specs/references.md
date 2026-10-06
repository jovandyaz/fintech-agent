# References

Industry and regulatory research that shaped 00–04, done on 2026-10-05. Each row says what it changed in the spec. Primary sources were opened; press-only claims are marked.

## Regulation (Mexico)

| Source | Version | Used for |
| --- | --- | --- |
| [Autorización de albo como IFPE, DOF](https://dof.gob.mx/nota_detalle.php?codigo=5651790&fecha=12/05/2022) | 2022-05-12 | 00 assumption 7: which rules apply |
| [LTOSF art. 23](https://www.diputados.gob.mx/LeyesBiblio/pdf/LTOSF.pdf) | Last reform DOF 2025-11-14 | Aclaración deadlines, acuse, dictamen, CONDUSEF (00, 01 folio, 02, 03 `must_mention`, policy 03) |
| [LPDUSF art. 50 Bis](https://www.diputados.gob.mx/LeyesBiblio/pdf/LPDUSF.pdf) | DOF 2025-11-14 | UNE answers in 30 business days (policy 03) |
| [Banxico Circular 12/2018](https://www.banxico.org.mx/marco-normativo/normativa-emitida-por-el-banco-de-mexico/circular-12-2018/%7BA6023AE0-8135-44ED-04DA-2068117ED5FD%7D.pdf), rule 18.a | DOF 2018-09-10 | Unrecognized charge credit by 2nd business day, no extra steps (00 assumption 4, 03 CARD-UNREC-03, policy 04) |
| [Banxico Circular 14/2017 (SPEI)](https://www.banxico.org.mx/marco-normativo/normativa-emitida-por-el-banco-de-mexico/circular-14-2017/%7BA06FBFEE-06BB-F249-32FC-25B334B2A744%7D.pdf), rules 17a, 19a, 23a–25a, 84a–86a | Compiled through Circ. 9/2026, DOF 2026-06-17 | SPEI timings, returns, CEP (03 SPEI-OUT-01, policies 01–02) |
| [CNBV–Banxico rules for IFPEs](https://www.cnbv.gob.mx/Normatividad/Disposiciones%20aplicables%20a%20las%20instituciones%20de%20fondos%20de%20pago%20electr%C3%B3nico%20a%20que%20se%20refieren%20los%20art%C3%ADculos%2048,%20segundo%20p%C3%A1rrafo;%2054,%20primer%20p%C3%A1rrafo%20y%2056,%20primer.pdf), arts. 1, 18 fr. III, 44–45 | DOF 2021-01-28 | Never request auth factors (`AUTH_FACTOR_REQUEST`); first name only to the model |
| [LFPDPPP](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf), arts. 2, 10–13, 18, 20, 24, 26 | DOF 2025-03-20, last reform 2025-11-14 | Provider as processor, minimization, retention, human intervention (DESIGN.md) |

Not confirmed: amendments to Circ. 12/2018 after 2018; CONDUSEF amount ceilings on art. 23; CONDUSEF transparency rules for ITFs; whether a new LFPDPPP regulation covers cloud processors; whether albo is a direct SPEI participant. No binding CNBV or Banxico rule specific to AI was found.

## Regulation (international benchmarks)

| Source | Version | Used for |
| --- | --- | --- |
| [PCI SSC, Summary of Changes v3.2.1 → v4.0](https://listings.pcisecuritystandards.org/documents/PCI-DSS-v3-2-1-to-v4-0-Summary-of-Changes-r1.pdf), req. 3.4.1, 3.5.1 | May 2022 (v4.0.1 text is behind the license wall) | Card display and storage rules (02 G6) |
| [CFPB, Chatbots in consumer finance](https://www.consumerfinance.gov/data-research/research-reports/chatbots-in-consumer-finance/chatbots-in-consumer-finance/) | 2023-06-06 | Colloquial dispute case (03 CARD-UNREC-01) |
| [12 CFR 1005.11 (Reg E)](https://www.consumerfinance.gov/rules-policy/regulations/1005/11/) | Current | Benchmark in DESIGN.md |
| [EU AI Act art. 50](https://artificialintelligenceact.eu/article/50/), [Annex III](https://artificialintelligenceact.eu/annex/3/) | Art. 50 applies from 2026-08-02 | Not high-risk; benchmark in DESIGN.md |
| *Moffatt v. Air Canada*, 2024 BCCRT 149 ([summary](https://en.wikipedia.org/wiki/Moffatt_v._Air_Canada); tribunal text not opened) | 2024-02-14 | A reply is a binding statement (`COMMITMENT_IN_REPLY` blocks, 02 G5) |

## Agent security

| Source | Date | Used for |
| --- | --- | --- |
| [OWASP LLM05:2025 Improper Output Handling](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/) | 2025 | `LINK_IN_REPLY`, plain-text console, CSP |
| [OWASP LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) | 2025 | G1–G3 framing |
| [OWASP LLM08:2025 Vector and Embedding Weaknesses](https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/) | 2025 | Chunk normalization (G8) |
| [OWASP Top 10 for Agentic Applications](https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/) | 2025-12-09 | Flag acknowledgment before approve (G3); DESIGN.md mapping |
| [MCP specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog), [tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) | 2026-07-28 | Stateless protocol, SDK v2 (01); RFC 9728 / 8707 when auth is used, no token passthrough, servers MUST rate limit tool calls, annotations untrusted, `isError` (G4) |
| [MCP Security Best Practices](https://modelcontextprotocol.io/specification/draft/basic/security_best_practices) | Draft | Confused deputy, token passthrough (G4) |
| [Meta, Agents Rule of Two](https://ai.meta.com/blog/practical-ai-agent-security/) | 2025-10-31 | Pattern name in 02 and DESIGN.md |
| [Willison, The lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) | 2025-06-16 | Pattern name |
| [Beurer-Kellner et al., Design Patterns for Securing LLM Agents](https://arxiv.org/abs/2506.08837) | 2025-06 | Why the design is not Action-Selector |
| [Debenedetti et al., CaMeL](https://arxiv.org/abs/2503.18813) | 2025-03-24 | "With more time" |
| [Willison on "The Attacker Moves Second"](https://simonwillison.net/2025/Nov/2/new-prompt-injection-papers/) (paper not opened) | 2025-11-02 | Why the guard is only a signal |
| [Anthropic, Mitigating prompt injections in browser use](https://www.anthropic.com/research/prompt-injection-defenses) | 2025-11-24 | Residual risk framing |
| [OpenAI, Safety in building agents](https://developers.openai.com/api/docs/guides/agent-builder-safety) | Undated | Untrusted input in the user role (G7) |
| [NIST AI 600-1](https://doi.org/10.6028/NIST.AI.600-1) | 2024-07-26 | Risk categories only; action ids not quoted |
| [promptfoo red-team plugins](https://www.promptfoo.dev/docs/red-team/plugins/) | Current | Optional red-team pass (DESIGN.md) |

## Industry practice

| Source | Date | Used for |
| --- | --- | --- |
| [Airbnb, Agent-in-the-Loop](https://arxiv.org/abs/2510.06674) | 2025-10 | `reject_code`, operator signal |
| [Nubank, support agents and LLM judges (KDD '26)](https://arxiv.org/html/2606.08867v1) | 2026-06 | Judge calibration bar (3 analysts, majority vote, accuracy 73–89% on a 30% held-out split; kappa only between judge models); approved response macros (commitment placeholders); not adopting GEPA |
| [Ramp, Policy Agent GA](https://ramp.com/blog/ramp-policy-agent-ga-launch) | 2026-01-13 | Review routing, `missing_policy` backlog |
| [OpenAI, A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf) | 2025 | Risk-rated review tiers (`review_tier`) |
| [Anthropic, Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | 2026-01-09 | Regression gate; grade outcomes, not paths |
| [Intercom Fin outcomes](https://www.intercom.com/help/en/articles/8205718-fin-ai-agent-outcomes) | Read 2026-10-05 | Approval is not resolution; re-contact metric (PLAYBOOK) |
| [Stripe, dispute management](https://stripe.com/payments/dispute-management) | Undated | Deadline-bound decisions alert |
| [Stripe compliance agents (AWS blog)](https://aws.amazon.com/blogs/machine-learning/production-grade-ai-agents-for-financial-compliance-lessons-from-stripe/) | 2026-06-26 | Cached tokens per invocation |
| [Monzo, Ops agent](https://monzo.com/blog/engineering-the-future-of-customer-operations-the-monzo-ops-agent) | 2026-06-04 | Rollout ladder, backtest (PLAYBOOK) |
| [Brex, AI on-call engineer](https://www.brex.com/journal/how-we-built-an-ai-oncall-engineer) | Undated | Backtest on closed tickets |
| Klarna CEO on quality vs cost (Bloomberg, **press only**) | 2025-05 | "Cost never buys back a missed dispute" (03 decision rule) |
| My own "Estrategia de adopción de IA — startup fintech" (Claude Docs) | 2026-09-30 | Agent setup (AGENTS.md map, hooks, narrow reviewer), risk matrix T3 for SPEI and personal data, Coinbase job description, Ramp exposure budget, Banxico's four elements |
| [Klarna AI assistant press release](https://www.klarna.com/international/press/klarna-ai-assistant-handles-two-thirds-of-customer-service-chats-in-its-first-month/) (self-reported) | 2024-02-27 | Re-contact as outcome metric |

## Second pass: residual risks and the whole design (2026-10-05)

Seven parallel researchers checked every accepted residual risk and every component against comparable fintechs and published designs. What each source changed:

| Source | Date | Used for |
| --- | --- | --- |
| [Presidio credit card recognizer](https://raw.githubusercontent.com/microsoft/presidio/main/presidio-analyzer/presidio_analyzer/predefined_recognizers/generic/credit_card_recognizer.py), [issue #2315](https://github.com/data-privacy-stack/presidio/issues/2315) | 2026-09-29 | DLPs gate on Luhn and miss spelled numbers → fail-closed sweep (G6) |
| [Google Sensitive Data Protection infoTypes](https://docs.cloud.google.com/sensitive-data-protection/docs/infotypes-reference) | Read 2026-10-05 | CURP detector exists, CLABE does not |
| [Intercom, PAN redaction](https://www.intercom.com/help/en/articles/8524626-redacting-primary-account-numbers-pan-in-conversations) | Read 2026-10-05 | Luhn-gated redaction and its false positives |
| [Stripe, designing object ids](https://dev.to/stripe/designing-apis-for-humans-object-ids-3o5a) | Undated | Prefixed ids make leak filters trivial → identifier registry (G6) |
| [Skyflow, LLM privacy vault](https://docs.skyflow.com/docs/fundamentals/patterns/llm-privacy) | Read 2026-10-05 | Tokenize-in, re-identify-out pattern; per-case vault is "with more time" |
| [PCI DSS v4.0 SAQ D](https://listings.pcisecuritystandards.org/documents/PCI-DSS-v4-0-SAQ-D-Merchant.pdf), [PCI SSC AI principles](https://blog.pcisecuritystandards.org/ai-principles-securing-the-use-of-ai-in-payment-environments) | 2022 / 2026 | 3.3.1, 3.4.1, 3.5.1; limit data to AI, filter output (G6) |
| [UTS #39 Unicode Security Mechanisms](https://www.unicode.org/reports/tr39/) | Current | Skeleton folding of invisible and confusable characters (G6) |
| [AWS, Unicode character smuggling](https://aws.amazon.com/blogs/security/defending-llm-applications-against-unicode-character-smuggling/) | Undated | Unicode Tags quarantine (G8) |
| [Progent](https://arxiv.org/html/2504.11703), [Jacob et al., type-directed separation](https://arxiv.org/html/2509.25926) | 2025 | Deterministic action policy works; valid-but-wrong choice stays (02 defense model) |
| [Ramp, merchant classification guardrails](https://builders.ramp.com/post/fixing-merchant-classifications-with-ai), [Decagon AOPs](https://decagon.ai/blog/why-we-built-aop), [Sierra, defense in depth](https://sierra.ai/blog/defense-in-depth-in-the-age-of-agents) | 2025–2026 | Actions limited by data, checks in code (G2 fact predicates, G5) |
| [Intercom Fin procedures](https://www.intercom.com/help/en/articles/12495167-fin-procedures-explained) | Read 2026-10-05 | Coded rules run whatever the model chose (`POLICY_DATA_CONFLICT`) |
| [Anthropic, reduce hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations), [Citations](https://platform.claude.com/docs/en/build-with-claude/citations) | Current | Quote extraction; Citations API incompatible with structured outputs (`CITATION_QUOTE_MISMATCH`) |
| [Anthropic, Contextual retrieval](https://www.anthropic.com/news/contextual-retrieval) | 2024-09 | Why not long-context or embeddings for ten docs (01 Retrieval) |
| [PostgreSQL 16 text search controls](https://www.postgresql.org/docs/16/textsearch-controls.html), [unaccent](https://www.postgresql.org/docs/16/unaccent.html) | 16 | `plainto_tsquery` ANDs words; `es_unaccent` config (01 Retrieval) |
| [EU AI Act art. 14](https://artificialintelligenceact.eu/article/14/) | 2024 | Over-reliance awareness (G3 canaries, forcing function) |
| [ICO, human review in AI decisions](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/artificial-intelligence/guidance-on-ai-and-data-protection/how-do-we-ensure-individual-rights-in-our-ai-systems/) | Current | A rubber-stamped approval is not review; monitor acceptance (G3) |
| [Buçinca et al., cognitive forcing functions (CSCW 2021)](https://www.eecs.harvard.edu/~kgajos/papers/2021/bucinca2021trust.shtml) | 2021 | Transaction check-off on `high` tier (G3) |
| [EU Reg. 2015/1998](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32015R1998) §12.5 (headings confirmed; content via search snippet) | 2015 | Threat Image Projection → canary proposals (G3) |
| [OWASP AI Agent Security cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html) | Current | Execution component validates independently (G1) |
| [Monzo, staff RPC access](https://monzo.com/blog/2022/05/26/humans-who-can-rpc-securing-staff-access-to-microservices), [network isolation](https://monzo.com/blog/we-built-network-isolation-for-1-500-services) | 2022–2023 | Service and credential separation for money paths (G1) |
| [CNBV–Banxico IFPE rules, DOF 2021-01-28](https://dof.gob.mx/nota_detalle.php?codigo=5610487&fecha=28/01/2021) arts. 24, 29, 36 | 2021 | Segregated access profiles, individual audit, log fields (G1, G3) |
| [Visa dispute management guidelines](https://usa.visa.com/dam/VCOM/global/support-legal/documents/merchants-dispute-management-guidelines.pdf) (Compelling Evidence 3.0) | Current | `first_party_signal` from the customer's own history |
| [Standard Webhooks spec](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md), [Stripe webhooks](https://docs.stripe.com/webhooks) | Current | Signed timestamp, ±5 min, rotation (01, T7) |
| [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests), [transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html) | Current | Executor outbox with idempotency key (G3) |
| [pg-boss Drizzle adapter](https://pgboss.io/api/adapters) | 12.37 | Atomic enqueue is not unique to the case-row queue (01 rationale) |
| [AI SDK loop control](https://ai-sdk.dev/docs/agents/loop-control), [generateText `timeout`](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text), [telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry) | 7.0.128 | `stopWhen` array, `timeout` object, content recording off (01) |
| [Anthropic API errors](https://platform.claude.com/docs/en/api/errors), [rate limits](https://platform.claude.com/docs/en/api/rate-limits) | Current | No forced tool use on current models; spend-limit errors not retryable (01) |
| [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai) | Development | Content is opt-in (01 Observability) |
| [τ-bench](https://arxiv.org/html/2406.12045) | 2024 | pass^k estimator (03) |
| [Husain, LLM judges](https://hamel.dev/blog/posts/llm-judge/), [Shankar et al., Who Validates the Validators](https://arxiv.org/abs/2404.12272) | 2024 | TPR/TNR, blind labeling, frozen rubric (03) |
| [Miller, Adding error bars to evals](https://arxiv.org/abs/2411.00640) | 2024 | Wilson intervals, paired comparison (03) |
| [AgentDojo](https://arxiv.org/abs/2406.13352), [InjecAgent](https://arxiv.org/abs/2403.02691) | 2024 | Injection through tool outputs (ADV-07) |
| [promptfoo test cases](https://www.promptfoo.dev/docs/configuration/test-cases) | 0.124 | Per-test `options.repeat`, cache per repeat index (03 Runner) |
| [Microsoft HAX guidelines](https://www.microsoft.com/en-us/haxtoolkit/library/) | Current | Efficient correction (operator override), convey consequences (Approve label) |
| [Sierra, release governance](https://sierra.ai/blog/release-governance-guardrails-for-agents-at-scale) | 2026 | Immutable releases, rollback (DESIGN rollout) |
| [DPD disables AI chatbot (ITV)](https://www.itv.com/news/2024-01-19/dpd-disables-ai-chatbot-after-customer-service-bot-appears-to-go-rogue) (press) | 2024-01-19 | Kill switch `AGENT_MODE` |
| [CONDUSEF REUNE API guide](https://api-reune-docs.condusef.gob.mx/pdf/Guia-reclamaciones-gral.pdf) | Current | Complaint report fields vs our schema (`docs/compliance.md`) |

Not verified in a primary source: how Nubank, Revolut, Klarna, Ramp, Brex or Mercury handle PII with LLMs (nothing public); the NIST AI 600-1 action ids; the PCI DSS v4.0.1 text (licensed; SAQ D v4.0 read instead); Revolut's AI resolution figures; whether a Mexican rule requires disclosing AI-drafted replies sent by a human (none found; a negative search, not a confirmation).
