import type { ActionType } from '@fintech-agent/contracts';

/** How one measure spread over the real runs: quartiles by upper nearest rank. */
export interface Spread {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

/**
 * The 52 variant-A runs of `evals/results/2026-10-08-0576343-140923Z.json`
 * (commit 0576343): the envelope a canary's scripted run is calibrated
 * against, so its trace reads like theirs in the console (02 G3).
 */
export const REAL_RUNS = 52;

/** Run totals as `agent_runs` stores them, the redactor's call included. */
export const REAL_INPUT_TOKENS = {
  min: 9_919,
  q1: 15_454,
  median: 15_911,
  q3: 22_442,
  max: 30_610,
} as const satisfies Spread;
export const REAL_OUTPUT_TOKENS = {
  min: 649,
  q1: 1_195,
  median: 1_412,
  q3: 2_232,
  max: 3_108,
} as const satisfies Spread;
export const REAL_LATENCY_MS = {
  min: 8_803,
  q1: 13_272,
  median: 14_225,
  q3: 22_009,
  max: 37_674,
} as const satisfies Spread;
export const REAL_COST_USD = {
  min: 0.026_272,
  q1: 0.041_853,
  median: 0.044_725,
  q3: 0.066_102,
  max: 0.081_88,
} as const satisfies Spread;

/** `run_steps` rows of every kind per run. */
export const REAL_STEPS = {
  min: 7,
  q1: 10,
  median: 10,
  q3: 12,
  max: 14,
} as const satisfies Spread;

/** MCP tool calls per run; `search_policies` is a retrieval step, not one. */
export const REAL_TOOL_CALLS = {
  min: 1,
  q1: 3,
  median: 3,
  q3: 3,
  max: 5,
} as const satisfies Spread;

/** Runs whose first answer failed validation and took the repair turn. */
export const REAL_REPAIRED_RUNS = 17;

/** The action each run proposed. */
export const REAL_ACTIONS = {
  none: 28,
  open_dispute: 15,
  resend_cep: 6,
  escalate_fraud: 3,
} as const satisfies Record<ActionType, number>;

/** Lengths in characters of the 69 model answers, the repaired ones included. */
export const REAL_TEXT_CHARS = {
  reasoningSummary: { min: 202, median: 331, max: 492 },
  justification: { min: 138, median: 229, max: 380 },
  draftReply: { min: 289, median: 580, max: 846 },
} as const;
