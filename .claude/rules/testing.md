---
paths:
  - '**/*.spec.ts'
  - '**/*.int.spec.ts'
  - '**/*.test.mjs'
  - '**/vitest.config.ts'
---

# Testing

- `*.spec.ts` are unit tests: no network, no Docker, no API key. `*.int.spec.ts` are integration tests and start Postgres with Testcontainers.
- No test calls a real LLM. Use the scripted `MockLanguageModelV4` fixtures in `test/mock-model.ts` (tool calls, structured output, `429`, timeouts, malformed JSON).
- Name the production change that would make a test fail before writing it. Assert on behavior (rows written, responses, errors), not on mock call counts.
- Tests for G1–G8 only grow. The PreToolUse hook blocks `skip`, `only`, `todo` and test removal in protected specs; if one is truly obsolete, ask the user.
- Data is deterministic: fixed seeds, fixed ids from `data/scenarios.ts`, fixed clocks where time matters (business-day math).
- A bug fix starts with the test that reproduces it.
