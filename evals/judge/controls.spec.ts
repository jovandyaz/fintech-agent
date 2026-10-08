import {
  CardAuthorizationSchema,
  CustomerViewSchema,
  SpeiStatusSchema,
} from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';

import { CLEAN_DRAFT, JUDGE_CONTROLS, KNOWN_DEFECTS } from './controls.js';

const AMOUNT = /\$?\d[\d,.]*/g;
const PROMISE_WORDS = /reembols|abon|devol|\d/i;
const PLACEHOLDER = /\{\{[a-z_]+\}\}/g;
const OUTPUT_SCHEMAS = {
  get_customer: CustomerViewSchema,
  get_card_authorization: CardAuthorizationSchema,
  get_spei_status: SpeiStatusSchema,
} as const;

const controlFor = (defect: (typeof KNOWN_DEFECTS)[number]) =>
  JUDGE_CONTROLS.find((control) => control.defect === defect)?.input;

describe('known-bad judge controls (03 §Judge validation, step 2)', () => {
  it('plants each of the seven defects once', () => {
    expect(JUDGE_CONTROLS.map(({ defect }) => defect)).toEqual([
      ...KNOWN_DEFECTS,
    ]);
  });

  it('feeds the judge tool outputs shaped as the MCP tools return them', () => {
    const inputs = [CLEAN_DRAFT, ...JUDGE_CONTROLS.map(({ input }) => input)];
    for (const { tool, output } of inputs.flatMap((i) => i.tool_outputs)) {
      const schema = OUTPUT_SCHEMAS[tool as keyof typeof OUTPUT_SCHEMAS];
      expect(schema.safeParse(output).success, tool).toBe(true);
    }
  });

  it('differs from the clean draft in what each control plants', () => {
    for (const control of JUDGE_CONTROLS) {
      const sameDraft = control.input.draft_reply === CLEAN_DRAFT.draft_reply;
      const sameCitations =
        control.input.cited_chunks === CLEAN_DRAFT.cited_chunks;
      expect(sameDraft && sameCitations, control.defect).toBe(false);
    }
  });

  it('drops only the citation in the uncited-policy control, whose draft states a rule', () => {
    const uncited = controlFor('policy_not_cited');
    expect(uncited?.draft_reply).toBe(CLEAN_DRAFT.draft_reply);
    expect(uncited?.cited_chunks).toEqual([]);
    expect(uncited?.draft_reply).toMatch(
      /no necesitas hacer ningún otro trámite/,
    );
  });

  it('asks for an authentication factor in the auth-factor control, and only there', () => {
    const asksForFactor = /\b(CVV|NIP|contraseña|código)\b/i;
    for (const control of JUDGE_CONTROLS) {
      expect(
        asksForFactor.test(control.input.draft_reply),
        control.defect,
      ).toBe(control.defect === 'auth_factor_request');
    }
  });

  it('paraphrases the promise with no number and no promise word', () => {
    const draft = controlFor('paraphrased_promise')?.draft_reply ?? '';
    expect(draft.replace(PLACEHOLDER, '')).not.toMatch(PROMISE_WORDS);
  });

  it('keeps the clean draft to figures the tool outputs hold', () => {
    const toolText = JSON.stringify(CLEAN_DRAFT.tool_outputs);
    for (const figure of CLEAN_DRAFT.draft_reply.match(AMOUNT) ?? []) {
      expect(toolText).toContain(figure.replace(/[$,]/g, ''));
    }
  });
});
