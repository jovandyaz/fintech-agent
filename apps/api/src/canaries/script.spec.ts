import { ResolutionSchema } from '@fintech-agent/contracts';
import type { LanguageModel } from 'ai';
import { describe, expect, it } from 'vitest';

import {
  canaryModelsOf,
  investigationOf,
  resolutionOf,
  type ScriptPacing,
} from './script.js';
import { CANARY_TEMPLATES } from './templates.js';

type ModelV4 = Extract<LanguageModel, { specificationVersion: 'v4' }>;
type CallOptions = Parameters<ModelV4['doGenerate']>[0];

const AGENT_MODEL = 'claude-sonnet-5-5';
const REDACTOR_MODEL = 'claude-haiku-5-5';
const CALL: CallOptions = { prompt: [] };
const [TEMPLATE] = CANARY_TEMPLATES;
const SHORTEST_REDACTOR_MS = 600;

function pacing(): ScriptPacing & { slept: number[] } {
  const slept: number[] = [];
  return {
    slept,
    random: () => 0.5,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  };
}

const modelsFor = (paced = pacing(), agentModelId = AGENT_MODEL) =>
  canaryModelsOf(TEMPLATE!, {
    redactorModelId: REDACTOR_MODEL,
    agentModelId,
    pacing: paced,
  });

const toolCallsOf = (
  content: Awaited<ReturnType<ModelV4['doGenerate']>>['content'],
) =>
  content.flatMap((part) =>
    part.type === 'tool-call'
      ? [{ tool: part.toolName, input: JSON.parse(part.input) as unknown }]
      : [],
  );

const textOf = (
  content: Awaited<ReturnType<ModelV4['doGenerate']>>['content'],
) =>
  content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');

async function investigate(agent: ModelV4): Promise<unknown[]> {
  const calls: unknown[] = [];
  const steps = investigationOf(TEMPLATE!.seed).length;
  for (let call = 0; call < steps; call += 1) {
    calls.push(...toolCallsOf((await agent.doGenerate(CALL)).content));
  }
  return calls;
}

describe('canaryModelsOf (02 G3)', () => {
  it('calls the investigation tools one per step, then answers the resolution', async () => {
    const { agent } = modelsFor();
    expect(await investigate(agent)).toEqual(investigationOf(TEMPLATE!.seed));
    const final = await agent.doGenerate(CALL);
    expect(final.finishReason.unified).toBe('stop');
    expect(ResolutionSchema.parse(JSON.parse(textOf(final.content)))).toEqual(
      resolutionOf(TEMPLATE!.seed),
    );
  });

  it('answers the same resolution again on a repair turn', async () => {
    const { agent } = modelsFor();
    await investigate(agent);
    const first = textOf((await agent.doGenerate(CALL)).content);
    expect(textOf((await agent.doGenerate(CALL)).content)).toBe(first);
  });

  it('reads first the customer and the movements, then each lookup, then the cited policies by document', () => {
    const { seed } = TEMPLATE!;
    expect(investigationOf(seed)).toEqual([
      { tool: 'get_customer', input: {} },
      { tool: 'list_transactions', input: {} },
      ...seed.lookups.map(({ tool, transaction_id }) => ({
        tool,
        input: { transaction_id },
      })),
      ...seed.citations.map(({ section, doc_id }) => ({
        tool: 'search_policies',
        input: { query: section, doc_id, k: 3 },
      })),
    ]);
  });

  it('makes the redactor find nothing in the canary text', async () => {
    const { redactor } = modelsFor();
    const { content } = await redactor.doGenerate(CALL);
    expect(JSON.parse(textOf(content))).toEqual({ spans: [] });
  });

  it('keeps the agent and the redactor apart when both run on the same model id', async () => {
    const { agent, redactor } = modelsFor(pacing(), REDACTOR_MODEL);
    expect(agent.modelId).toBe(REDACTOR_MODEL);
    expect(redactor.modelId).toBe(REDACTOR_MODEL);
    expect(toolCallsOf((await agent.doGenerate(CALL)).content)).toEqual([
      investigationOf(TEMPLATE!.seed)[0],
    ]);
  });

  it('takes time and reports tokens the way a provider call does, growing with the conversation', async () => {
    const paced = pacing();
    const { agent } = modelsFor(paced);
    const first = await agent.doGenerate(CALL);
    const second = await agent.doGenerate(CALL);
    expect(paced.slept.every((ms) => ms > 0)).toBe(true);
    expect(second.usage.inputTokens.total!).toBeGreaterThan(
      first.usage.inputTokens.total!,
    );
    expect(first.response?.headers?.['request-id']).toMatch(
      /^req_[0-9A-Za-z]{24}$/,
    );
    expect(agent.modelId).toBe(AGENT_MODEL);
    expect(agent.provider).toBe('anthropic.messages');
  });

  it('reads nothing from a prompt cache, as the agent sets none (no cacheControl)', async () => {
    const { agent, redactor } = modelsFor();
    for (const model of [redactor, agent, agent, agent]) {
      const { usage } = await model.doGenerate(CALL);
      expect(usage.inputTokens.cacheRead).toBe(0);
      expect(usage.inputTokens.noCache).toBe(usage.inputTokens.total);
    }
  });

  it('builds a fresh script on every call, so each run replays the investigation', async () => {
    const once = modelsFor();
    await once.agent.doGenerate(CALL);
    expect(
      toolCallsOf((await modelsFor().agent.doGenerate(CALL)).content),
    ).toEqual([investigationOf(TEMPLATE!.seed)[0]]);
  });

  it('paces each call like a provider call by default', async () => {
    const { redactor } = canaryModelsOf(TEMPLATE!, {
      redactorModelId: REDACTOR_MODEL,
      agentModelId: AGENT_MODEL,
    });
    const started = performance.now();
    await redactor.doGenerate(CALL);
    expect(performance.now() - started).toBeGreaterThanOrEqual(
      SHORTEST_REDACTOR_MS,
    );
  });
});
