import type { ActionType } from '@fintech-agent/contracts';

import { HAIKU_MODEL, SONNET_MODEL } from '../agent/core/prices.js';
import type { AgentVariant } from '../config.js';

/** How one measure spread over the real runs: quartiles by upper nearest rank. */
export interface Spread {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

/** How long one field of the model answers ran, in characters. */
export interface Lengths {
  min: number;
  median: number;
  max: number;
}

/** One variant's real runs: the envelope its canaries' scripted runs are calibrated against. */
export interface RealRuns {
  /** The agent model they ran on; `costUsd` holds at its prices only. */
  model: string;
  runs: number;
  /** Run totals as `agent_runs` stores them, the redactor's call included. */
  inputTokens: Spread;
  outputTokens: Spread;
  latencyMs: Spread;
  costUsd: Spread;
  /** `run_steps` rows of every kind per run. */
  steps: Spread;
  /** MCP tool calls per run; `search_policies` is a retrieval step, not one. */
  toolCalls: Spread;
  /** Runs whose first answer failed validation and took the repair turn. */
  repairedRuns: number;
  /** The action each run proposed. */
  actions: Record<ActionType, number>;
  /** Over every model answer, the ones sent back for repair included. */
  textChars: {
    reasoningSummary: Lengths;
    justification: Lengths;
    draftReply: Lengths;
  };
}

/** The final full eval run, whose runs of each variant `REAL_RUNS` measures. */
export const REAL_RUNS_FILE = 'evals/results/2026-10-11-07ac584-205556Z.json';

/**
 * Per agent variant, what its 52 runs in `REAL_RUNS_FILE` measured, so a
 * canary's trace reads like those of the variant the stack runs (02 G3);
 * `real-runs.spec.ts` derives every number again from the file.
 */
export const REAL_RUNS: Readonly<Record<AgentVariant, RealRuns>> = {
  A: {
    model: SONNET_MODEL,
    runs: 52,
    inputTokens: {
      min: 9_935,
      q1: 16_033,
      median: 16_776,
      q3: 22_945,
      max: 35_364,
    },
    outputTokens: { min: 656, q1: 1_331, median: 1_569, q3: 2_346, max: 2_920 },
    latencyMs: {
      min: 7_316,
      q1: 11_595,
      median: 13_085,
      q3: 18_435,
      max: 23_765,
    },
    costUsd: {
      min: 0.025_395,
      q1: 0.044_873,
      median: 0.047_117,
      q3: 0.067_974,
      max: 0.092_105,
    },
    steps: { min: 7, q1: 10, median: 12, q3: 12, max: 16 },
    toolCalls: { min: 1, q1: 3, median: 3, q3: 3, max: 5 },
    repairedRuns: 23,
    actions: { none: 25, open_dispute: 17, resend_cep: 7, escalate_fraud: 3 },
    textChars: {
      reasoningSummary: { min: 214, median: 302, max: 428 },
      justification: { min: 133, median: 242, max: 392 },
      draftReply: { min: 317, median: 606, max: 970 },
    },
  },
  B: {
    model: HAIKU_MODEL,
    runs: 52,
    inputTokens: {
      min: 4_928,
      q1: 15_372,
      median: 16_192,
      q3: 23_248,
      max: 31_263,
    },
    outputTokens: { min: 729, q1: 1_868, median: 2_412, q3: 3_010, max: 5_689 },
    latencyMs: {
      min: 5_377,
      q1: 11_045,
      median: 14_733,
      q3: 17_232,
      max: 26_325,
    },
    costUsd: {
      min: 0.000_857,
      q1: 0.002_469,
      median: 0.002_93,
      q3: 0.003_942,
      max: 0.005_646,
    },
    steps: { min: 4, q1: 10, median: 10, q3: 12, max: 14 },
    toolCalls: { min: 0, q1: 3, median: 3, q3: 3, max: 5 },
    repairedRuns: 13,
    actions: { none: 24, open_dispute: 18, resend_cep: 7, escalate_fraud: 3 },
    textChars: {
      reasoningSummary: { min: 250, median: 393, max: 552 },
      justification: { min: 165, median: 299, max: 485 },
      draftReply: { min: 303, median: 614, max: 966 },
    },
  },
};
