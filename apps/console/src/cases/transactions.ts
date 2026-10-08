import type { TransactionRow } from '@fintech-agent/contracts/console';

const AMOUNT = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
});
const DAY = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' });

const counterpartOf = (row: TransactionRow): string =>
  'merchant_descriptor' in row
    ? row.merchant_descriptor
    : row.counterparty_first_name;

/**
 * One transaction as the operator checks it: id, merchant or counterparty,
 * amount and day; the id alone when the core could not list it.
 */
export function describeTransaction(
  id: string,
  rows: readonly TransactionRow[] | undefined,
): string {
  const row = rows?.find((candidate) => candidate.id === id);
  if (!row) return id;
  return [
    row.id,
    counterpartOf(row),
    AMOUNT.format(row.amount),
    DAY.format(new Date(row.created_at)),
  ].join(' · ');
}
