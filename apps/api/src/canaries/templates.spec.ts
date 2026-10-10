import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CARD_TYPES,
  CustomerRecordSchema,
  ListTransactionsInputSchema,
  TransactionRecordSchema,
  cardAuthorizationOf,
  isSpeiRecord,
  maskPii,
  speiStatusOf,
  transactionRowOf,
  type CustomerView,
  type Transaction,
} from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { shapeViolation } from '../actions/allowed.js';
import { DATASET_NOW } from '../../../../data/scenarios.js';
import {
  buildEvidence,
  type ToolResult,
} from '../agent/core/validate/evidence.js';
import { factFlags } from '../agent/core/validate/flags.js';
import { validate } from '../agent/core/validate/index.js';
import {
  groundingAtoms,
  numberAtoms,
  ungroundedAtoms,
} from '../agent/core/validate/numbers.js';
import { replyViolations } from '../replies/reply-checks.js';
import { POLICIES_DIR, loadCorpus } from '../retrieval/ingest.js';
import { REAL_ACTIONS, REAL_RUNS, REAL_TEXT_CHARS } from './real-runs.js';
import { misreadResolutionOf, resolutionOf } from './script.js';
import {
  CANARY_DEFECTS,
  CANARY_TEMPLATES,
  canaryTemplateOf,
  type CanarySeed,
  type CanaryTemplate,
} from './templates.js';

const dataset = <T>(file: string, schema: z.ZodType<T>): T[] =>
  z
    .array(schema)
    .parse(
      JSON.parse(
        readFileSync(
          resolve(import.meta.dirname, '../../../../data', file),
          'utf8',
        ),
      ),
    );
const DATASET = dataset('transactions.json', TransactionRecordSchema);
const CUSTOMERS = dataset('customers.json', CustomerRecordSchema);
const LAST_FOUR = 4;
const byId = new Map<string, Transaction>(DATASET.map((tx) => [tx.id, tx]));
const MIN_PHRASINGS = 3;
// The batch proposes none about as often as variant A did (28 of 52), so a
// none-heavy inbox cannot tell a canary batch apart.
const NONE_SHARE_TOLERANCE = 0.15;
const [CARD_PURCHASE] = CARD_TYPES;
const LONG_DIGIT_RUN = /\d{8,}/;

const caseOf = (
  { defect, seed }: CanaryTemplate,
  text = seed.texts[0]!,
): Parameters<typeof canaryTemplateOf>[0] => ({
  defect,
  customerId: seed.customerId,
  textMasked: maskPii(text),
});

// The core's list filter (apps/core-mock), so the run below sees the rows the
// seed's filters return and Persist's flags read the same evidence.
function listed(seed: CanarySeed): Transaction[] {
  const filter = ListTransactionsInputSchema.parse(seed.listFilter);
  const needle = filter.query?.toLowerCase();
  const at = (instant: string | undefined) =>
    instant === undefined ? undefined : Date.parse(instant);
  const [from, to] = [at(filter.from), at(filter.to)];
  return DATASET.filter(
    (tx) =>
      tx.customer_id === seed.customerId &&
      (filter.type === undefined || tx.type === filter.type) &&
      (filter.status === undefined || tx.status === filter.status) &&
      (from === undefined || Date.parse(tx.created_at) >= from) &&
      (to === undefined || Date.parse(tx.created_at) <= to) &&
      (filter.min_amount === undefined || tx.amount >= filter.min_amount) &&
      (filter.max_amount === undefined || tx.amount <= filter.max_amount) &&
      (needle === undefined ||
        (tx.type === CARD_PURCHASE
          ? tx.merchant_descriptor
          : tx.counterparty_name
        )
          .toLowerCase()
          .includes(needle)),
  )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, filter.limit);
}

describe('canary templates (02 G3)', () => {
  it('has a template for every defect, grouped in CANARY_DEFECTS order', () => {
    const defects = CANARY_TEMPLATES.map(({ defect }) => defect);
    expect(
      defects.filter((defect, index) => defect !== defects[index - 1]),
    ).toEqual([...CANARY_DEFECTS]);
  });

  it('puts every template on its own customer and transactions, so a batch never shows one charge under two actions', () => {
    const customers = CANARY_TEMPLATES.map(({ seed }) => seed.customerId);
    expect(new Set(customers).size).toBe(customers.length);
    const transactions = CANARY_TEMPLATES.flatMap(({ seed }) => [
      ...new Set([
        ...seed.lookups.map(({ transaction_id }) => transaction_id),
        ...seed.action.transaction_ids,
      ]),
    ]);
    expect(new Set(transactions).size).toBe(transactions.length);
  });

  it('covers every defect, the dangerous none several times', () => {
    const defects = CANARY_TEMPLATES.map(({ defect }) => defect);
    expect(new Set(defects)).toEqual(new Set(CANARY_DEFECTS));
    const noneShare =
      CANARY_TEMPLATES.filter(({ seed }) => seed.action.type === 'none')
        .length / CANARY_TEMPLATES.length;
    expect(
      Math.abs(noneShare - REAL_ACTIONS.none / REAL_RUNS),
    ).toBeLessThanOrEqual(NONE_SHARE_TOLERANCE);
  });

  it.each(CANARY_TEMPLATES)(
    '$defect ($seed.customerId) looks like a proposal that passed validation',
    ({ seed: { draftReply, customerId, action } }) => {
      expect(replyViolations(draftReply)).toEqual([]);
      const transactions = action.transaction_ids.map((id) => byId.get(id));
      expect(transactions.every((tx) => tx?.customer_id === customerId)).toBe(
        true,
      );
      expect(
        shapeViolation(
          action.type,
          transactions.flatMap((tx) => (tx ? [tx] : [])),
        ),
      ).toBeNull();
    },
  );

  it.each(CANARY_TEMPLATES)(
    '$defect ($seed.customerId) writes paragraphs as long as real answers, naming figures as the tools print them',
    ({ seed }) => {
      const lengths = {
        reasoningSummary: seed.reasoningSummary.length,
        justification: seed.action.justification.length,
        draftReply: seed.draftReply.length,
      };
      for (const [field, length] of Object.entries(lengths)) {
        const { min, max } =
          REAL_TEXT_CHARS[field as keyof typeof REAL_TEXT_CHARS];
        expect(length, field).toBeGreaterThanOrEqual(min);
        expect(length, field).toBeLessThanOrEqual(max);
      }
      expect(numberAtoms(seed.draftReply)).not.toEqual([]);
    },
  );

  it.each(CANARY_TEMPLATES)(
    '$defect ($seed.customerId) narrows the movements to rows that hold every transaction it looks up',
    ({ seed }) => {
      const rows = listed(seed).map(({ id }) => id);
      expect(rows.length).toBeGreaterThan(0);
      for (const { transaction_id } of seed.lookups) {
        expect(rows).toContain(transaction_id);
      }
    },
  );

  it.each(CANARY_TEMPLATES)(
    '$defect ($seed.customerId) searches each policy with phrases of its own, never its title',
    ({ seed }) => {
      for (const { citation, queries } of seed.policies) {
        expect(queries.length).toBeGreaterThanOrEqual(MIN_PHRASINGS);
        expect(queries).not.toContain(citation.section);
      }
    },
  );

  it('gives every canary several wordings of its own, none shared with another', () => {
    for (const { seed } of CANARY_TEMPLATES) {
      expect(seed.texts.length).toBeGreaterThanOrEqual(MIN_PHRASINGS);
    }
    const texts = CANARY_TEMPLATES.flatMap(({ seed }) =>
      seed.texts.map(maskPii),
    );
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('never names itself', () => {
    const seeds = CANARY_TEMPLATES.map(({ seed }) => seed);
    expect(JSON.stringify(seeds).toLowerCase()).not.toMatch(
      /canar|defect|wrong|test/,
    );
  });
});

describe('canaryTemplateOf (02 G3)', () => {
  it.each(CANARY_TEMPLATES)(
    'replays $defect ($seed.customerId) for a case holding any of its wordings',
    (template) => {
      for (const text of template.seed.texts) {
        expect(canaryTemplateOf(caseOf(template, text))).toBe(template);
      }
    },
  );

  it('refuses a case whose text, customer or defect matches no template', () => {
    const template = CANARY_TEMPLATES[0]!;
    expect(() =>
      canaryTemplateOf({ ...caseOf(template), textMasked: 'otro texto' }),
    ).toThrow();
    expect(() =>
      canaryTemplateOf({ ...caseOf(template), customerId: 'cus_99' }),
    ).toThrow();
    expect(() =>
      canaryTemplateOf({ ...caseOf(template), defect: 'cold_tone' }),
    ).toThrow();
  });
});

const CORPUS = loadCorpus(POLICIES_DIR);
const STATE_RULES = CORPUS.map(({ id, quarantined, stateRules }) => ({
  chunk_id: id,
  quarantined,
  rules: stateRules,
}));

// What a run on the case would have seen; a lookup whose tool does not fit the
// transaction returns nothing, as the MCP server answers WRONG_TYPE.
function runFor(seed: CanarySeed): ToolResult[] {
  const customer = CUSTOMERS.find(({ id }) => id === seed.customerId)!;
  const view: CustomerView = {
    first_name: customer.first_name,
    account_status: customer.account_status,
    kyc_level: customer.kyc_level,
    clabe: maskPii(customer.clabe),
    card_last4: customer.card_pan.slice(-LAST_FOUR),
    card_status: customer.card_status,
  };
  const rows = listed(seed);
  const statuses = seed.lookups.flatMap(
    ({ tool, transaction_id }): ToolResult[] => {
      const tx = byId.get(transaction_id);
      if (!tx) return [];
      if (isSpeiRecord(tx)) {
        return tool === 'get_spei_status'
          ? [{ tool, output: speiStatusOf(tx) }]
          : [];
      }
      return tool === 'get_card_authorization'
        ? [{ tool, output: cardAuthorizationOf(tx) }]
        : [];
    },
  );
  const cited = seed.policies.map(({ citation }) => citation.chunk_id);
  return [
    { tool: 'get_customer', output: view },
    {
      tool: 'list_transactions',
      output: {
        items: rows.map(transactionRowOf),
        total: rows.length,
        next_cursor: null,
        truncated: false,
      },
    },
    ...statuses,
    {
      tool: 'search_policies',
      output: {
        chunks: CORPUS.filter(
          ({ id, quarantined }) => !quarantined && cited.includes(id),
        ).map((chunk) => ({
          chunk_id: chunk.id,
          doc_id: chunk.docId,
          section: chunk.section,
          content: chunk.content,
        })),
      },
    },
  ];
}

describe('canary templates through the validator (02 G3, G5)', () => {
  const at = new Date(DATASET_NOW);
  const evidenceFor = (seed: CanarySeed) =>
    buildEvidence({
      toolResults: runFor(seed),
      receivedAt: at,
      now: at,
      injectionSignal: false,
      crossCustomerLookup: false,
    });

  it.each(CANARY_TEMPLATES)(
    '$defect ($seed.customerId) passes every check, citing real policy, with the flags Persist computes',
    ({ seed }) => {
      const resolution = resolutionOf(seed);
      const evidence = evidenceFor(seed);
      expect(
        validate(resolution, { evidence, stateRules: STATE_RULES }),
      ).toMatchObject({ ok: true, conflicts: [] });
      expect(seed.policies).not.toEqual([]);
      expect(factFlags(resolution, evidence, { priorOpenDisputes: 0 })).toEqual(
        seed.flags,
      );
    },
  );

  it.each(CANARY_TEMPLATES)(
    '$defect ($seed.customerId) keeps long digit runs out of its draft and states only figures its tools print',
    ({ seed }) => {
      expect(seed.draftReply).not.toMatch(LONG_DIGIT_RUN);
      const evidence = evidenceFor(seed);
      const citedTexts = seed.policies.flatMap(({ citation }) => {
        const chunk = evidence.chunks.get(citation.chunk_id);
        return chunk ? [chunk.content] : [];
      });
      expect(
        ungroundedAtoms(
          seed.draftReply,
          groundingAtoms({ outputs: evidence.outputs, citedTexts }),
        ),
      ).toEqual([]);
    },
  );

  it.each(CANARY_TEMPLATES)(
    '$defect ($seed.customerId) misreads one figure in a way only UNGROUNDED_NUMBER catches',
    ({ seed }) => {
      expect(seed.draftReply).toContain(seed.movement.amount);
      expect(
        validate(misreadResolutionOf(seed), {
          evidence: evidenceFor(seed),
          stateRules: STATE_RULES,
        }),
      ).toMatchObject({ ok: false, codes: ['UNGROUNDED_NUMBER'] });
    },
  );
});
