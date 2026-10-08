import { hasPii, maskPii } from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import { fixtureOf } from './fixtures.js';
import { CLEAN_DRAFT } from './judge/controls.js';
import { judgeText } from './judge/text.js';
import { evalProvider, variantLabel, type EvalAttempt } from './provider.js';
import { evalRunOf } from './test/eval-run.js';

const context = (case_id: string, repeatIndex: number) =>
  ({ vars: { case_id }, repeatIndex, prompt: { raw: '', label: '' } }) as never;

describe('the eval case fixtures (the step 2 webhook fixtures)', () => {
  it('reads a case as the webhook would receive it', () => {
    expect(fixtureOf('CARD-UNREC-01')).toMatchObject({
      customerId: 'cus_07',
      receivedAt: new Date('2026-10-05T15:00:00-06:00'),
    });
    expect(fixtureOf('CARD-UNREC-01').text).toContain('PAYPAL');
  });

  it('refuses an id with no fixture', () => {
    expect(() => fixtureOf('NOPE-01')).toThrow('NOPE-01');
  });
});

describe('judgeText', () => {
  it('puts the draft, every cited chunk and every tool output in front of the judge, nothing else', () => {
    const text = judgeText(CLEAN_DRAFT);
    expect(text).toContain(CLEAN_DRAFT.draft_reply);
    expect(text).toContain(CLEAN_DRAFT.cited_chunks[0]!.text);
    expect(text).toContain('"merchant_descriptor": "PAYPAL *DIGITALGOODS"');
    expect(text).not.toMatch(/open_dispute|label|expected/i);
  });
});

describe('evalProvider (03 §Runner: the real harness behind one promptfoo provider)', () => {
  const attempts: Parameters<EvalAttempt>[0][] = [];
  const run = evalRunOf();
  const provider = evalProvider({
    variant: 'B',
    attempt: (fixture) => {
      attempts.push(fixture);
      return Promise.resolve(run);
    },
  });

  it('names the variant as its label, so results never merge across variants', () => {
    expect(provider.label).toBe('variant-B');
    expect(variantLabel('A')).toBe('variant-A');
  });

  it('runs one attempt of the fixture behind the case and reports its cost and tokens', async () => {
    const response = await provider.callApi('', context('CARD-UNREC-01', 2));
    expect(attempts.at(-1)).toEqual(fixtureOf('CARD-UNREC-01'));
    expect(response).toMatchObject({
      output: judgeText(run.judge_input),
      cost: run.cost_usd,
      tokenUsage: {
        prompt: run.input_tokens,
        completion: run.output_tokens,
        total: run.input_tokens + run.output_tokens,
      },
    });
    expect(response.metadata).toMatchObject({
      run,
      repeat_index: 2,
      judge_input: run.judge_input,
      customer_text: maskPii(fixtureOf('CARD-UNREC-01').text),
      model: run.model,
      prompt_version: run.prompt_version,
    });
  });

  it('keeps the customer text it records masked: no CLABE, card or phone reaches the results (02 G6)', async () => {
    const response = await provider.callApi('', context('ADV-10', 0));
    expect(hasPii(fixtureOf('ADV-10').text)).toBe(true);
    expect(hasPii(String(response.metadata?.['customer_text']))).toBe(false);
  });

  it('turns a run that ended failed into a provider error naming its code, never a graded empty answer', async () => {
    const failed = evalProvider({
      variant: 'A',
      attempt: () =>
        Promise.resolve(
          evalRunOf({
            run_status: 'failed',
            error_code: 'no_api_key',
            proposal: null,
            draft_reply: null,
          }),
        ),
    });
    await expect(failed.callApi('', context('GEN-01', 0))).rejects.toThrow(
      'GEN-01 ended failed: no_api_key',
    );
  });

  it('grades a run that fell back: the safe fallback is an answer', async () => {
    const fellBack = evalProvider({
      variant: 'A',
      attempt: () => Promise.resolve(evalRunOf({ run_status: 'fallback' })),
    });
    await expect(
      fellBack.callApi('', context('GEN-01', 0)),
    ).resolves.toHaveProperty('metadata.run.run_status', 'fallback');
  });

  it('lets a failed attempt fail the test as a provider error, never as an empty answer', async () => {
    const failing = evalProvider({
      variant: 'A',
      attempt: () => Promise.reject(new Error('stack down')),
    });
    await expect(failing.callApi('', context('GEN-01', 0))).rejects.toThrow(
      'stack down',
    );
  });
});
