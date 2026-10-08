import { describe, expect, it } from 'vitest';

import { agentStateOf } from './agent-state.js';

describe('agentStateOf', () => {
  it.each([
    ['on', 'sk-ant-key', 'on'],
    ['on', '', 'no_api_key'],
    ['off', 'sk-ant-key', 'off'],
    ['off', '', 'off'],
  ] as const)('reads AGENT_MODE=%s with key "%s" as %s', (mode, key, state) => {
    expect(agentStateOf({ AGENT_MODE: mode, ANTHROPIC_API_KEY: key })).toBe(
      state,
    );
  });
});
