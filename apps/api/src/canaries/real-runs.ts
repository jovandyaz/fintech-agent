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

/**
 * Input tokens a model call adds as a line over the characters it reads anew,
 * `base + perChar × chars`, and how the real calls' residuals spread.
 */
export interface TokenLine {
  base: number;
  perChar: number;
  residual: { min: number; q1: number; q3: number; max: number };
}

/** One variant's real runs: the envelope its canaries' scripted runs are calibrated against. */
export interface RealRuns {
  /** The agent model they ran on; `costUsd` holds at its prices only. */
  model: string;
  /** The redactor model they ran with, whose rates give each redaction call its cost. */
  redactorModel: string;
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
  /** What each model call read anew against the input tokens it reported. */
  promptTokens: {
    /** The redactor's call, over the delimited case text. */
    redactor: TokenLine;
    /** The agent's first call, over the case message. */
    caseMessage: TokenLine;
    /** A call after a tool step, over the text the model reads of its results. */
    toolResults: TokenLine;
  };
}

/** The final full eval run, whose runs of each variant `REAL_RUNS` measures. */
export const REAL_RUNS_FILE = 'evals/results/2026-10-13-8d25722-043801Z.json';

/** The steps of each run in `REAL_RUNS_FILE`, from `evals/export-steps.sql`. */
export const REAL_STEPS_FILE =
  'evals/results/2026-10-13-8d25722-043801Z.steps.json';

/** What the repair prompt added in every real run that repaired for `UNGROUNDED_NUMBER` alone. */
export const UNGROUNDED_REPAIR_TOKENS = 46;

/**
 * Per agent variant, what its 52 runs in `REAL_RUNS_FILE` measured, so a
 * canary's trace reads like those of the variant the stack runs (02 G3);
 * `real-runs.spec.ts` derives every number again from the file.
 */
export const REAL_RUNS: Readonly<Record<AgentVariant, RealRuns>> = {
  A: {
    model: SONNET_MODEL,
    redactorModel: HAIKU_MODEL,
    runs: 52,
    inputTokens: {
      min: 9_898,
      q1: 15_714,
      median: 16_111,
      q3: 22_929,
      max: 29_155,
    },
    outputTokens: { min: 675, q1: 1_246, median: 1_542, q3: 2_264, max: 2_816 },
    latencyMs: {
      min: 6_984,
      q1: 11_165,
      median: 13_509,
      q3: 18_302,
      max: 28_967,
    },
    costUsd: {
      min: 0.026_667,
      q1: 0.043_087,
      median: 0.046_412,
      q3: 0.067_566,
      max: 0.083_32,
    },
    steps: { min: 7, q1: 10, median: 10, q3: 12, max: 14 },
    toolCalls: { min: 1, q1: 3, median: 3, q3: 3, max: 5 },
    repairedRuns: 20,
    actions: { none: 25, open_dispute: 17, resend_cep: 7, escalate_fraud: 3 },
    textChars: {
      reasoningSummary: { min: 216, median: 309, max: 416 },
      justification: { min: 131, median: 236, max: 403 },
      draftReply: { min: 268, median: 543, max: 806 },
    },
    promptTokens: {
      redactor: {
        base: 437,
        perChar: 0.4381,
        residual: { min: -5, q1: -1, q3: 2, max: 8 },
      },
      caseMessage: {
        base: 4_386,
        perChar: 0.4381,
        residual: { min: -5, q1: -1, q3: 2, max: 8 },
      },
      toolResults: {
        base: 35,
        perChar: 0.4626,
        residual: { min: -62, q1: -26, q3: 25, max: 68 },
      },
    },
  },
  B: {
    model: HAIKU_MODEL,
    redactorModel: HAIKU_MODEL,
    runs: 52,
    inputTokens: {
      min: 4_931,
      q1: 15_405,
      median: 16_395,
      q3: 23_465,
      max: 35_999,
    },
    outputTokens: { min: 769, q1: 1_784, median: 2_426, q3: 3_201, max: 4_555 },
    latencyMs: {
      min: 5_998,
      q1: 11_610,
      median: 14_732,
      q3: 18_374,
      max: 51_034,
    },
    costUsd: {
      min: 0.000_878,
      q1: 0.002_468,
      median: 0.003_011,
      q3: 0.004_035,
      max: 0.005_772,
    },
    steps: { min: 4, q1: 10, median: 10, q3: 12, max: 16 },
    toolCalls: { min: 0, q1: 3, median: 3, q3: 3, max: 5 },
    repairedRuns: 16,
    actions: { none: 25, open_dispute: 17, resend_cep: 7, escalate_fraud: 3 },
    textChars: {
      reasoningSummary: { min: 280, median: 391, max: 510 },
      justification: { min: 141, median: 290, max: 506 },
      draftReply: { min: 281, median: 559, max: 863 },
    },
    promptTokens: {
      redactor: {
        base: 437,
        perChar: 0.4381,
        residual: { min: -5, q1: -1, q3: 2, max: 8 },
      },
      caseMessage: {
        base: 4_386,
        perChar: 0.4381,
        residual: { min: -5, q1: -1, q3: 2, max: 8 },
      },
      toolResults: {
        base: 65,
        perChar: 0.425,
        residual: { min: -97, q1: -24, q3: 16, max: 84 },
      },
    },
  },
};
