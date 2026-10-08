import { setTimeout as sleep } from 'node:timers/promises';

import type { Resolution } from '@fintech-agent/contracts';
import type { LanguageModel } from 'ai';

import type { CanarySeed, CanaryTemplate, LookupTool } from './templates.js';

type ModelV4 = Extract<LanguageModel, { specificationVersion: 'v4' }>;
type Generated = Awaited<ReturnType<ModelV4['doGenerate']>>;
type Range = readonly [min: number, max: number];

/** How a scripted call spends time; tests pass a sleep that returns at once. */
export interface ScriptPacing {
  random: () => number;
  sleep: (ms: number) => Promise<void>;
}

/** The redactor and agent models a canary's case runs with. */
export interface ScriptedModels {
  redactor: ModelV4;
  agent: ModelV4;
}

const PROVIDER_PACING: ScriptPacing = {
  random: () => Math.random(),
  sleep: (ms) => sleep(ms),
};

/** One tool call of a canary's investigation, as the agent makes it. */
export interface ScriptedCall {
  tool: string;
  input: Record<string, unknown>;
}

// The provider string and id shapes the Anthropic messages model reports, so a
// scripted call reads like a real one wherever a trace or span shows it.
const PROVIDER = 'anthropic.messages';
const ID_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const REQUEST_ID_CHARS = 24;
const POLICY_RESULTS = 3;
const FINISH = { toolCalls: 'tool-calls', stop: 'stop' } as const;

// A canary's run totals sit next to real runs' in the console (02 G3), so
// each call takes and costs what a Sonnet-class call on this prompt does; the
// agent sets no cacheControl, so no call reads from a prompt cache.
const FIRST_INPUT_TOKENS: Range = [3_200, 4_200];
const INPUT_GROWTH_TOKENS: Range = [350, 1_400];
const TOOL_CALL_OUTPUT_TOKENS: Range = [30, 110];
const RESOLUTION_OUTPUT_TOKENS: Range = [380, 720];
const TOOL_CALL_MS: Range = [1_300, 3_800];
const RESOLUTION_MS: Range = [4_500, 9_500];
const REDACTOR_INPUT_TOKENS: Range = [420, 760];
const REDACTOR_OUTPUT_TOKENS: Range = [6, 14];
const REDACTOR_MS: Range = [600, 1_600];

const EVIDENCE_KIND: Record<
  LookupTool,
  Resolution['evidence'][number]['kind']
> = {
  get_card_authorization: 'card_auth',
  get_spei_status: 'spei',
};

interface Turn {
  content: Generated['content'];
  finish: (typeof FINISH)[keyof typeof FINISH];
  ms: Range;
  outputTokens: Range;
}

const between = ([min, max]: Range, random: () => number): number =>
  Math.round(min + random() * (max - min));

const idOf = (prefix: string, random: () => number): string =>
  prefix +
  Array.from(
    { length: REQUEST_ID_CHARS },
    () => ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)],
  ).join('');

/**
 * What a canary's agent reads before concluding: the customer, the
 * movements, each transaction its seed looks up, and every policy section it
 * cites, searched within its own document.
 */
export function investigationOf(seed: CanarySeed): ScriptedCall[] {
  return [
    { tool: 'get_customer', input: {} },
    { tool: 'list_transactions', input: {} },
    ...seed.lookups.map(({ tool, transaction_id }) => ({
      tool,
      input: { transaction_id },
    })),
    ...seed.citations.map(({ section, doc_id }) => ({
      tool: 'search_policies',
      input: { query: section, doc_id, k: POLICY_RESULTS },
    })),
  ];
}

/** The resolution a canary's agent answers: its seed, with the lookups as evidence. */
export function resolutionOf(seed: CanarySeed): Resolution {
  return {
    category: seed.category,
    draft_reply: seed.draftReply,
    citations: seed.citations,
    abstained: false,
    evidence: seed.lookups.map(({ tool, transaction_id }) => ({
      kind: EVIDENCE_KIND[tool],
      id: transaction_id,
    })),
    proposed_action: seed.action,
    reasoning_summary: seed.reasoningSummary,
  };
}

function scriptedModel(
  modelId: string,
  pacing: ScriptPacing,
  firstInput: Range,
  turnAt: (call: number) => Turn,
): ModelV4 {
  let calls = 0;
  let previousInput = 0;
  return {
    specificationVersion: 'v4',
    provider: PROVIDER,
    modelId,
    supportedUrls: {},
    doGenerate: async (): Promise<Generated> => {
      const call = calls++;
      const turn = turnAt(call);
      await pacing.sleep(between(turn.ms, pacing.random));
      const input =
        call === 0
          ? between(firstInput, pacing.random)
          : previousInput + between(INPUT_GROWTH_TOKENS, pacing.random);
      previousInput = input;
      const output = between(turn.outputTokens, pacing.random);
      return {
        content: turn.content,
        finishReason: { unified: turn.finish, raw: turn.finish },
        usage: {
          inputTokens: {
            total: input,
            noCache: input,
            cacheRead: 0,
            cacheWrite: 0,
          },
          outputTokens: { total: output, text: output, reasoning: 0 },
        },
        response: {
          modelId,
          timestamp: new Date(),
          headers: { 'request-id': idOf('req_', pacing.random) },
        },
        warnings: [],
      };
    },
    doStream: () =>
      Promise.reject(new Error('a scripted model answers generate calls only')),
  };
}

const answerTurn = (text: string, ms: Range, outputTokens: Range): Turn => ({
  content: [{ type: 'text', text }],
  finish: FINISH.stop,
  ms,
  outputTokens,
});

/**
 * The models a canary's case runs with instead of the provider's (02 G3), by
 * role, so a variant whose agent shares the redactor's model id still gets
 * the right script: the redactor finds nothing, and the agent replays the
 * template's investigation one tool call per step, then answers its
 * resolution, again on any repair turn. Each call builds fresh scripts, so a
 * re-run replays them from the start; production pacing unless given another.
 */
export function canaryModelsOf(
  template: CanaryTemplate,
  input: {
    redactorModelId: string;
    agentModelId: string;
    pacing?: ScriptPacing;
  },
): ScriptedModels {
  const pacing = input.pacing ?? PROVIDER_PACING;
  const calls = investigationOf(template.seed);
  const answer = JSON.stringify(resolutionOf(template.seed));
  const nothingToRedact = JSON.stringify({ spans: [] });
  return {
    redactor: scriptedModel(
      input.redactorModelId,
      pacing,
      REDACTOR_INPUT_TOKENS,
      () => answerTurn(nothingToRedact, REDACTOR_MS, REDACTOR_OUTPUT_TOKENS),
    ),
    agent: scriptedModel(
      input.agentModelId,
      pacing,
      FIRST_INPUT_TOKENS,
      (call) => {
        const next = calls[call];
        if (!next) {
          return answerTurn(answer, RESOLUTION_MS, RESOLUTION_OUTPUT_TOKENS);
        }
        return {
          content: [
            {
              type: 'tool-call',
              toolCallId: idOf('toolu_', pacing.random),
              toolName: next.tool,
              input: JSON.stringify(next.input),
            },
          ],
          finish: FINISH.toolCalls,
          ms: TOOL_CALL_MS,
          outputTokens: TOOL_CALL_OUTPUT_TOKENS,
        };
      },
    ),
  };
}
