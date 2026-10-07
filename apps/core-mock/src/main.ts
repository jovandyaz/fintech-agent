import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Customer, Transaction } from '@fintech-agent/contracts';

import { createCoreMock } from './server.js';

const DEFAULT_PORT = 3010;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const dataDir =
  process.env.DATA_DIR ?? join(import.meta.dirname, '../../../data');
const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(join(dataDir, file), 'utf8')) as T;

const core = createCoreMock({
  customers: readJson<Customer[]>('customers.json'),
  transactions: readJson<Transaction[]>('transactions.json'),
  readKey: required('CORE_READ_KEY'),
  executorKey: required('CORE_EXECUTOR_KEY'),
  databasePath: process.env.CORE_DB_PATH ?? ':memory:',
});

const port = Number(process.env.CORE_MOCK_PORT ?? DEFAULT_PORT);
core.server.listen(port, () => {
  console.log(JSON.stringify({ event: 'core_mock_listening', port }));
});

const shutdown = (): void => {
  core.server.close(() => {
    core.close();
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
