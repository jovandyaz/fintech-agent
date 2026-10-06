import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DATASET_SEED, generateDataset } from './generate.js';

const DATA_DIR = import.meta.dirname;
const FIXTURES_DIR = join(DATA_DIR, 'webhook-fixtures');
const INDENT = 2;

const write = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, INDENT)}\n`);
};

const dataset = generateDataset(DATASET_SEED);
write(join(DATA_DIR, 'customers.json'), dataset.customers);
write(join(DATA_DIR, 'transactions.json'), dataset.transactions);
rmSync(FIXTURES_DIR, { recursive: true, force: true });
mkdirSync(FIXTURES_DIR);
for (const { scenario_id, event } of dataset.fixtures) {
  write(join(FIXTURES_DIR, `${scenario_id}.json`), event);
}
console.log(
  `wrote ${dataset.customers.length} customers, ${dataset.transactions.length} transactions, ${dataset.fixtures.length} fixtures`,
);
