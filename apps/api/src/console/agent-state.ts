import type { AgentState } from '@fintech-agent/contracts';

import type { ApiConfig } from '../config.js';

const NO_KEY = '';

/**
 * What the console's banner shows: the kill switch wins, then a blank key,
 * which ends every run with `no_api_key` (01).
 */
export function agentStateOf(
  config: Pick<ApiConfig, 'AGENT_MODE' | 'ANTHROPIC_API_KEY'>,
): AgentState {
  if (config.AGENT_MODE === 'off') return 'off';
  return config.ANTHROPIC_API_KEY === NO_KEY ? 'no_api_key' : 'on';
}
