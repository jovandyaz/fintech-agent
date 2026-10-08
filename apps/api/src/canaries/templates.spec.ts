import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  TransactionRecordSchema,
  cardAuthorizationOf,
  isSpeiRecord,
  speiStatusOf,
  transactionRowOf,
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
import { replyViolations } from '../replies/reply-checks.js';
import { POLICIES_DIR, loadCorpus } from '../retrieval/ingest.js';
import { resolutionOf } from './script.js';
import {
  CANARY_DEFECTS,
  CANARY_TEMPLATES,
  type CanarySeed,
} from './templates.js';

const DATASET = z
  .array(TransactionRecordSchema)
  .parse(
    JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, '../../../../data/transactions.json'),
        'utf8',
      ),
    ),
  );
const byId = new Map<string, Transaction>(DATASET.map((tx) => [tx.id, tx]));

describe('canary templates (02 G3)', () => {
  it('has one template per defect, in order', () => {
    expect(CANARY_TEMPLATES.map(({ defect }) => defect)).toEqual([
      ...CANARY_DEFECTS,
    ]);
  });

  it.each(CANARY_TEMPLATES)(
    '$defect looks like a proposal that passed validation',
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

  it('gives every canary its own customer text', () => {
    const texts = CANARY_TEMPLATES.map(({ seed }) => seed.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('keeps digits out of every draft, as the validator would demand', () => {
    for (const { seed } of CANARY_TEMPLATES) {
      expect(seed.draftReply).not.toMatch(/\d/);
    }
  });

  it('never names itself', () => {
    const seeds = CANARY_TEMPLATES.map(({ seed }) => seed);
    expect(JSON.stringify(seeds).toLowerCase()).not.toMatch(
      /canar|defect|wrong|test/,
    );
  });
});

const CORPUS = loadCorpus(POLICIES_DIR);
const STATE_RULES = CORPUS.map(({ id, quarantined, stateRules }) => ({
  chunk_id: id,
  quarantined,
  rules: stateRules,
}));

// What a run on the canary's case would have seen: the customer's movements,
// the status output of each transaction its seed looks up (none when the tool
// does not fit the transaction, as the MCP server answers WRONG_TYPE) and the
// policy chunks it cites, as search_policies returns them.
function runFor(seed: CanarySeed): ToolResult[] {
  const rows = DATASET.filter((tx) => tx.customer_id === seed.customerId);
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
  const cited = seed.citations.map(({ chunk_id }) => chunk_id);
  return [
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

  it.each(CANARY_TEMPLATES)(
    '$defect passes every check, citing real policy, with the flags Persist computes',
    ({ seed }) => {
      const resolution = resolutionOf(seed);
      const evidence = buildEvidence({
        toolResults: runFor(seed),
        receivedAt: at,
        now: at,
        injectionSignal: false,
        crossCustomerLookup: false,
      });
      expect(
        validate(resolution, { evidence, stateRules: STATE_RULES }),
      ).toMatchObject({ ok: true, conflicts: [] });
      expect(seed.citations).not.toEqual([]);
      expect(factFlags(resolution, evidence, { priorOpenDisputes: 0 })).toEqual(
        seed.flags,
      );
    },
  );
});
