import { setTimeout as sleep } from 'node:timers/promises';

import type { Resolution } from '@fintech-agent/contracts';
import type { LanguageModel } from 'ai';

import { POLICY_SEARCH_TOOL } from '../agent/core/validate/evidence.js';
import { drawOne } from './draw.js';
import { REAL_REPAIRED_RUNS, REAL_RUNS } from './real-runs.js';
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

/** One model step of a canary's investigation: the prose it opens with and the calls it makes together. */
export interface ScriptedStep {
  leadIn: string;
  calls: ScriptedCall[];
}

interface IdShape {
  prefix: string;
  chars: number;
}

// The provider string and id shapes the Anthropic messages model reports, so a
// scripted call reads like a real one wherever a trace or span shows it.
const PROVIDER = 'anthropic.messages';
const ID_ALPHABET = [
  ...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
];
const REQUEST_ID: IdShape = { prefix: 'req_011C', chars: 20 };
const TOOL_CALL_ID: IdShape = { prefix: 'toolu_01', chars: 22 };
const POLICY_RESULTS = 3;
const FINISH = { toolCalls: 'tool-calls', stop: 'stop' } as const;
// A scripted run answers first with a repairable slip as often as real runs did (02 G3).
const REPAIR_SHARE = REAL_REPAIRED_RUNS / REAL_RUNS;

// Calibrated against the real runs' envelope (real-runs.ts); the agent sets no
// cacheControl, so no call reads from a prompt cache.
const FIRST_INPUT_TOKENS: Range = [4_150, 4_550];
const TOOL_RESULTS_TOKENS: Range = [450, 950];
const REPAIR_PROMPT_TOKENS: Range = [40, 90];
const TOOL_STEP_OUTPUT_TOKENS: Range = [100, 240];
const ANSWER_OUTPUT_TOKENS: Range = [800, 1_150];
const TOOL_STEP_MS: Range = [1_800, 3_400];
const ANSWER_MS: Range = [6_500, 9_500];
const REDACTOR_INPUT_TOKENS: Range = [420, 760];
const REDACTOR_OUTPUT_TOKENS: Range = [6, 14];
const REDACTOR_MS: Range = [600, 1_600];
const NO_NEXT_PROMPT: Range = [0, 0];

const OPENING_LEAD_INS: readonly ((movement: string) => string)[] = [
  (movement) =>
    `Voy a revisar los datos del cliente y a buscar ${movement} entre sus movimientos.`,
  (movement) =>
    `Primero consulto el perfil del cliente y filtro sus movimientos para ubicar ${movement}.`,
  (movement) => `Busco ${movement} que reporta el cliente y reviso su cuenta.`,
  (movement) =>
    `Reviso la cuenta del cliente y los movimientos que coinciden con ${movement}.`,
];
const LOOKUP_LEAD_INS: readonly ((
  movement: string,
  detail: string,
) => string)[] = [
  (movement, detail) =>
    `Encontré ${movement}. Consulto ${detail} y la política que aplica.`,
  (movement, detail) =>
    `Ya ubiqué ${movement}; reviso ${detail} y busco la política correspondiente.`,
  (movement, detail) =>
    `Aparece ${movement}. Verifico ${detail} antes de proponer una acción.`,
  (movement, detail) =>
    `Para ${movement} reviso ${detail} y lo que dice la política sobre este caso.`,
];
const LOOKUP_DETAIL: Record<LookupTool, string> = {
  get_card_authorization: 'la autorización',
  get_spei_status: 'el estado del SPEI',
};

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
  // What the next call's prompt adds after this turn's output: tool results or the repair prompt.
  nextPromptTokens: Range;
}

const between = ([min, max]: Range, random: () => number): number =>
  Math.round(min + random() * (max - min));

const idOf = ({ prefix, chars }: IdShape, random: () => number): string =>
  prefix +
  Array.from({ length: chars }, () => drawOne(ID_ALPHABET, random)).join('');

const phraseOf = ({ noun, amount, at }: CanarySeed['movement']): string =>
  `${noun} de ${amount} ${at}`;

function lookupDetailOf(seed: CanarySeed): string {
  const [lookup] = seed.lookups;
  if (!lookup) throw new Error('a seed looks up at least one transaction');
  return LOOKUP_DETAIL[lookup.tool];
}

/**
 * What a canary's agent reads before concluding, step by step as real runs
 * do: the customer and its movements narrowed by the seed's filters, then
 * every transaction it looks up together with a search for every policy it
 * cites, worded in one of the seed's phrases within that policy's document.
 */
export function investigationOf(
  seed: CanarySeed,
  random: () => number,
): ScriptedStep[] {
  const movement = phraseOf(seed.movement);
  return [
    {
      leadIn: drawOne(OPENING_LEAD_INS, random)(movement),
      calls: [
        { tool: 'get_customer', input: {} },
        { tool: 'list_transactions', input: { ...seed.listFilter } },
      ],
    },
    {
      leadIn: drawOne(LOOKUP_LEAD_INS, random)(movement, lookupDetailOf(seed)),
      calls: [
        ...seed.lookups.map(({ tool, transaction_id }) => ({
          tool,
          input: { transaction_id },
        })),
        ...seed.policies.map(({ citation, queries }) => ({
          tool: POLICY_SEARCH_TOOL,
          input: {
            query: drawOne(queries, random),
            doc_id: citation.doc_id,
            k: POLICY_RESULTS,
          },
        })),
      ],
    },
  ];
}

/** The resolution a canary's agent answers: its seed, with the lookups as evidence. */
export function resolutionOf(seed: CanarySeed): Resolution {
  return {
    category: seed.category,
    draft_reply: seed.draftReply,
    citations: seed.policies.map(({ citation }) => citation),
    abstained: false,
    evidence: seed.lookups.map(({ tool, transaction_id }) => ({
      kind: EVIDENCE_KIND[tool],
      id: transaction_id,
    })),
    proposed_action: seed.action,
    reasoning_summary: seed.reasoningSummary,
  };
}

/**
 * The first answer of a run drawn to repair: the seed's resolution with its
 * movement's amount misread in the draft, which the validator rejects as
 * `UNGROUNDED_NUMBER` and the repair turn corrects. Throws when the draft
 * does not print the amount, since the run would then repair nothing.
 */
export function misreadResolutionOf(seed: CanarySeed): Resolution {
  const { amount } = seed.movement;
  if (!seed.draftReply.includes(amount)) {
    throw new Error('the draft does not print the amount to misread');
  }
  return {
    ...resolutionOf(seed),
    draft_reply: seed.draftReply.replace(amount, seed.misreadAmount),
  };
}

function scriptedModel(
  modelId: string,
  pacing: ScriptPacing,
  firstInput: Range,
  turnAt: (call: number) => Turn,
): ModelV4 {
  let calls = 0;
  let nextInput = 0;
  return {
    specificationVersion: 'v4',
    provider: PROVIDER,
    modelId,
    supportedUrls: {},
    doGenerate: async (): Promise<Generated> => {
      const call = calls++;
      const turn = turnAt(call);
      await pacing.sleep(between(turn.ms, pacing.random));
      const input = call === 0 ? between(firstInput, pacing.random) : nextInput;
      const output = between(turn.outputTokens, pacing.random);
      nextInput =
        input + output + between(turn.nextPromptTokens, pacing.random);
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
          headers: { 'request-id': idOf(REQUEST_ID, pacing.random) },
        },
        warnings: [],
      };
    },
    doStream: () =>
      Promise.reject(new Error('a scripted model answers generate calls only')),
  };
}

const answerTurn = (
  text: string,
  ms: Range,
  outputTokens: Range,
  nextPromptTokens: Range,
): Turn => ({
  content: [{ type: 'text', text }],
  finish: FINISH.stop,
  ms,
  outputTokens,
  nextPromptTokens,
});

function answerAt(answers: readonly string[], index: number): string {
  const answer = answers[index];
  if (answer === undefined) throw new Error('a script answers at least once');
  return answer;
}

const toolTurn = (step: ScriptedStep, random: () => number): Turn => ({
  content: [
    { type: 'text', text: step.leadIn },
    ...step.calls.map(({ tool, input }): Generated['content'][number] => ({
      type: 'tool-call',
      toolCallId: idOf(TOOL_CALL_ID, random),
      toolName: tool,
      input: JSON.stringify(input),
    })),
  ],
  finish: FINISH.toolCalls,
  ms: TOOL_STEP_MS,
  outputTokens: TOOL_STEP_OUTPUT_TOKENS,
  nextPromptTokens: TOOL_RESULTS_TOKENS,
});

/**
 * The models a canary's case runs with instead of the provider's (02 G3), by
 * role, so a variant whose agent shares the redactor's model id still gets
 * the right script: the redactor finds nothing, and the agent replays the
 * template's investigation in two steps of parallel calls, then answers its
 * resolution. A drawn share of runs answers first with a misread figure and
 * the resolution on the repair turn; any later call answers it again. Each
 * call builds fresh scripts, so a re-run replays them from the start;
 * production pacing unless given another.
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
  const repairs = pacing.random() < REPAIR_SHARE;
  const steps = investigationOf(template.seed, pacing.random);
  const resolution = JSON.stringify(resolutionOf(template.seed));
  const answers = repairs
    ? [JSON.stringify(misreadResolutionOf(template.seed)), resolution]
    : [resolution];
  const nothingToRedact = JSON.stringify({ spans: [] });
  return {
    redactor: scriptedModel(
      input.redactorModelId,
      pacing,
      REDACTOR_INPUT_TOKENS,
      () =>
        answerTurn(
          nothingToRedact,
          REDACTOR_MS,
          REDACTOR_OUTPUT_TOKENS,
          NO_NEXT_PROMPT,
        ),
    ),
    agent: scriptedModel(
      input.agentModelId,
      pacing,
      FIRST_INPUT_TOKENS,
      (call) => {
        const step = steps[call];
        if (step) return toolTurn(step, pacing.random);
        const index = Math.min(call - steps.length, answers.length - 1);
        return answerTurn(
          answerAt(answers, index),
          ANSWER_MS,
          ANSWER_OUTPUT_TOKENS,
          index < answers.length - 1 ? REPAIR_PROMPT_TOKENS : NO_NEXT_PROMPT,
        );
      },
    ),
  };
}
