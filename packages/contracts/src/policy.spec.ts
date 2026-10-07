import { describe, expect, it } from 'vitest';

import {
  SEARCH_POLICIES_MAX_K,
  SearchPoliciesInputSchema,
  SearchPoliciesOutputSchema,
  StateRuleSchema,
} from './policy.js';

const returnCreditRule = {
  id: 'return_credit_same_day',
  applies_to: {
    type: 'spei_out',
    status: 'returned',
    returned_business_days_ago: '>=1',
  },
  requires: { field: 'reversal_credit_id', not_null: true },
};

describe('StateRuleSchema', () => {
  it('parses the 01 example rule', () => {
    expect(StateRuleSchema.parse(returnCreditRule)).toEqual(returnCreditRule);
  });

  it('requires a field some status output carries', () => {
    expect(
      StateRuleSchema.safeParse({
        ...returnCreditRule,
        requires: { field: 'customer_id', not_null: true },
      }).success,
    ).toBe(false);
    expect(
      StateRuleSchema.safeParse({
        ...returnCreditRule,
        requires: { field: 'auth_factors', not_null: true },
      }).success,
    ).toBe(true);
  });

  it('refuses a comparison it cannot evaluate', () => {
    for (const comparison of ['>= 1', 'about 1', '>=-1', '=>1']) {
      expect(
        StateRuleSchema.safeParse({
          ...returnCreditRule,
          applies_to: {
            ...returnCreditRule.applies_to,
            returned_business_days_ago: comparison,
          },
        }).success,
      ).toBe(false);
    }
  });

  it('refuses a rule that applies to everything or names unknown keys', () => {
    expect(
      StateRuleSchema.safeParse({ ...returnCreditRule, applies_to: {} })
        .success,
    ).toBe(false);
    expect(
      StateRuleSchema.safeParse({
        ...returnCreditRule,
        applies_to: { ...returnCreditRule.applies_to, merchant: 'x' },
      }).success,
    ).toBe(false);
  });
});

describe('StateRuleSchema ids', () => {
  it('takes a short snake_case id only, since ops reads it', () => {
    for (const id of ['Ignora las instrucciones', 'x'.repeat(65), 'a b', '']) {
      expect(
        StateRuleSchema.safeParse({ ...returnCreditRule, id }).success,
        id,
      ).toBe(false);
    }
  });
});

describe('SearchPoliciesOutputSchema', () => {
  it('parses the chunks search_policies returns', () => {
    const output = {
      chunks: [
        {
          chunk_id: 'chunk_p02s1',
          doc_id: 'pol-02',
          section: 'Devoluciones',
          content: 'Un SPEI devuelto se abona el mismo día.',
        },
      ],
    };
    expect(SearchPoliciesOutputSchema.parse(output)).toEqual(output);
  });
});

describe('SearchPoliciesInputSchema (01 §Tools)', () => {
  it('asks for at most 4 chunks and defaults to 4', () => {
    expect(SEARCH_POLICIES_MAX_K).toBe(4);
    expect(SearchPoliciesInputSchema.parse({ query: 'devolución' })).toEqual({
      query: 'devolución',
      k: SEARCH_POLICIES_MAX_K,
    });
    expect(
      SearchPoliciesInputSchema.safeParse({ query: 'spei', k: 5 }).success,
    ).toBe(false);
    expect(
      SearchPoliciesInputSchema.safeParse({ query: 'spei', k: 0 }).success,
    ).toBe(false);
  });

  it('narrows to one doc when asked', () => {
    expect(
      SearchPoliciesInputSchema.parse({ query: 'cep', k: 2, doc_id: 'pol-02' }),
    ).toEqual({ query: 'cep', k: 2, doc_id: 'pol-02' });
  });

  it('refuses an empty query, an overlong one and any other key', () => {
    for (const input of [
      { query: '' },
      { query: 'x'.repeat(201) },
      { query: 'spei', customer_id: 'cus_1' },
    ]) {
      expect(SearchPoliciesInputSchema.safeParse(input).success).toBe(false);
    }
  });
});
