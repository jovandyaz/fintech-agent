import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { HAIKU_MODEL, SONNET_MODEL, pricingOf } from '../agent/core/prices.js';
import { inOrder, objectResponse, usage } from '../../test/mock-model.js';
import { computeTokenCostUsd } from '../agent/core/cost.js';
import {
  evalHarness,
  pricedRedaction,
  type EvalHarness,
} from './eval-harness.js';

const ENV_EXAMPLE = readFileSync(
  resolve(import.meta.dirname, '../../../../.env.example'),
  'utf8',
);
const noLog = () => undefined;

let harness: EvalHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe('evalHarness (03 §Runner: the dev defaults compose uses)', () => {
  it('runs each variant on its own model, the redactor on the Haiku model', () => {
    harness = evalHarness({ env: {}, envExample: ENV_EXAMPLE, log: noLog });
    expect(harness.depsFor('A').config).toMatchObject({
      variant: 'A',
      modelId: SONNET_MODEL,
      redactorModelId: HAIKU_MODEL,
    });
    expect(harness.depsFor('B').config).toMatchObject({
      variant: 'B',
      modelId: HAIKU_MODEL,
    });
  });

  it('runs the agent even when the environment has the kill switch on', () => {
    harness = evalHarness({
      env: { AGENT_MODE: 'off' },
      envExample: ENV_EXAMPLE,
      log: noLog,
    });
    expect(harness.depsFor('A').config.mode).toBe('on');
  });

  it('reaches the stack from the host: the MCP url on localhost, the audience the server expects', () => {
    harness = evalHarness({ env: {}, envExample: ENV_EXAMPLE, log: noLog });
    expect(harness.depsFor('A').config).toMatchObject({
      mcpUrl: 'http://localhost:3020/mcp',
      mcpAudience: 'http://mcp:3020/mcp',
    });
  });

  it('builds no provider models without a key, so nothing can be spent by mistake', () => {
    harness = evalHarness({
      env: { ANTHROPIC_API_KEY: '' },
      envExample: ENV_EXAMPLE,
      log: noLog,
    });
    expect(harness.depsFor('A').models).toBeNull();
  });

  it('refuses to run holding CORE_EXECUTOR_KEY, as the api does (02 G1)', () => {
    expect(() =>
      evalHarness({
        env: { CORE_EXECUTOR_KEY: 'x' },
        envExample: ENV_EXAMPLE,
        log: noLog,
      }),
    ).toThrow(/CORE_EXECUTOR_KEY/);
  });

  it('reports the redactor degraded and free without a key, so recall reads as missed, never as covered', async () => {
    harness = evalHarness({
      env: { ANTHROPIC_API_KEY: '' },
      envExample: ENV_EXAMPLE,
      log: noLog,
    });
    expect(await harness.redact('Mi clave es gatoazul.')).toEqual({
      spans: [],
      degraded: true,
      costUsd: 0,
    });
  });

  it('returns the spans the redactor applied, not degraded, priced at the redactor model', async () => {
    const outcome = await pricedRedaction('Mi clave es gatoazul, sí.', {
      model: inOrder(() =>
        objectResponse({ spans: ['gatoazul', 'no está'] }, usage(1000, 100)),
      ),
      modelId: HAIKU_MODEL,
    });
    expect(outcome.spans).toEqual(['gatoazul']);
    expect(outcome.degraded).toBe(false);
    expect(outcome.costUsd).toBe(
      computeTokenCostUsd(
        {
          inputTokens: 1000,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        pricingOf(HAIKU_MODEL),
      ),
    );
  });

  it('reports a redactor that failed as degraded, with no spans', async () => {
    const outcome = await pricedRedaction('Mi clave es gatoazul.', {
      model: inOrder(() => {
        throw new Error('overloaded');
      }),
      modelId: HAIKU_MODEL,
    });
    expect(outcome).toMatchObject({ spans: [], degraded: true });
  });

  it('serves the checked policy catalog to search_policies', () => {
    harness = evalHarness({ env: {}, envExample: ENV_EXAMPLE, log: noLog });
    expect(
      harness.depsFor('A').retrieval.catalog.map(({ doc_id }) => doc_id),
    ).toContain('pol-04');
  });
});
