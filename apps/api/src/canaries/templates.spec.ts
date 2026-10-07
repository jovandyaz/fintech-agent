import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  TransactionRecordSchema,
  type Transaction,
} from '@fintech-agent/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { shapeViolation } from '../actions/allowed.js';
import { replyViolations } from '../replies/reply-checks.js';
import { CANARY_DEFECTS, CANARY_TEMPLATES } from './templates.js';

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

  it('never names itself', () => {
    const seeds = CANARY_TEMPLATES.map(({ seed }) => seed);
    expect(JSON.stringify(seeds).toLowerCase()).not.toMatch(
      /canar|defect|wrong|test/,
    );
  });
});
