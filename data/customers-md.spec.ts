import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { customersMarkdown } from './customers-md.js';
import { DATASET_SEED, generateDataset } from './generate.js';

// 02 G6 masks any run of eight digits; this view shows none.
const EIGHT_DIGITS = /\d{8,}/;
const dataset = generateDataset(DATASET_SEED);
const markdown = customersMarkdown(dataset.customers, dataset.transactions);

describe('CUSTOMERS.md, the readable view of the dataset', () => {
  it('is the committed file, so it never drifts from the data', () => {
    expect(
      readFileSync(join(import.meta.dirname, 'CUSTOMERS.md'), 'utf8'),
    ).toBe(markdown);
  });

  it('lists every customer and every movement by id', () => {
    for (const { id } of dataset.customers) {
      expect(markdown).toContain(`## ${id} `);
    }
    for (const { id } of dataset.transactions) {
      expect(markdown).toContain(`| ${id} |`);
    }
  });

  it('shows no CLABE, card number, RFC, CURP, phone or email', () => {
    for (const customer of dataset.customers) {
      for (const value of [
        customer.clabe,
        customer.card_pan,
        customer.rfc,
        customer.curp,
        customer.phone,
        customer.email,
      ]) {
        expect(markdown).not.toContain(value);
      }
    }
    for (const tx of dataset.transactions) {
      if ('counterparty_clabe' in tx) {
        expect(markdown).not.toContain(tx.counterparty_clabe);
      }
    }
    expect(markdown).not.toMatch(EIGHT_DIGITS);
  });
});
