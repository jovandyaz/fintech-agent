import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;
const SATURDAY = 6;
const SUNDAY = 0;
const BANK_HOLIDAYS_PATH = resolve(
  import.meta.dirname,
  '../../../../../data/bank-holidays.json',
);

const BankCalendarSchema = z.object({
  time_zone: z.string(),
  years: z.record(
    z.string().regex(/^\d{4}$/),
    z.object({
      status: z.enum(['published', 'provisional']),
      source: z.string(),
      days: z.array(z.string().regex(ISO_DATE)),
    }),
  ),
});

/** The Mexican bank non-working days (`data/bank-holidays.json`), parsed once. */
export const BANK_CALENDAR = BankCalendarSchema.parse(
  JSON.parse(readFileSync(BANK_HOLIDAYS_PATH, 'utf8')),
);

const HOLIDAYS = new Set(
  Object.values(BANK_CALENDAR.years).flatMap(({ days }) => days),
);
const COVERED_YEARS = new Set(Object.keys(BANK_CALENDAR.years));

/** A date the calendar cannot answer for: its year has no holiday list. */
export class CalendarRangeError extends Error {
  constructor(day: string) {
    super(`no bank-holiday list covers ${day}`);
    this.name = 'CalendarRangeError';
  }
}

const LOCAL_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: BANK_CALENDAR.time_zone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The calendar day (`YYYY-MM-DD`) an instant falls on in Mexico City. */
export function localDateOf(instant: Date): string {
  return LOCAL_DATE.format(instant);
}

const LOCAL_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: BANK_CALENDAR.time_zone,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** The wall-clock time (`HH:MM`, 24-hour) of an instant in Mexico City. */
export function localTimeOf(instant: Date): string {
  return LOCAL_TIME.format(instant);
}

const ISO_DAY_LENGTH = 'YYYY-MM-DD'.length;
const YEAR_LENGTH = 'YYYY'.length;

const toUtcMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);
const fromUtcMs = (ms: number): string =>
  new Date(ms).toISOString().slice(0, ISO_DAY_LENGTH);
const nextDay = (day: string): string => fromUtcMs(toUtcMs(day) + MS_PER_DAY);

function isBusinessDay(day: string): boolean {
  if (!COVERED_YEARS.has(day.slice(0, YEAR_LENGTH)))
    throw new CalendarRangeError(day);
  const weekday = new Date(toUtcMs(day)).getUTCDay();
  return weekday !== SATURDAY && weekday !== SUNDAY && !HOLIDAYS.has(day);
}

/**
 * The `count`-th business day after `day`; `day` itself never counts, so a
 * Saturday start reaches its first business day on Monday. Throws
 * `CalendarRangeError` past the listed years instead of guessing.
 */
export function addBusinessDays(day: string, count: number): string {
  let current = day;
  for (let found = 0; found < count;) {
    current = nextDay(current);
    if (isBusinessDay(current)) found += 1;
  }
  return current;
}

/** Calendar-day arithmetic; needs no holiday list, so it never throws. */
export function addNaturalDays(day: string, count: number): string {
  return fromUtcMs(toUtcMs(day) + count * MS_PER_DAY);
}

/** Business days in (`from`, `to`]; zero when `to` is not after `from`. */
export function businessDaysBetween(from: string, to: string): number {
  let count = 0;
  for (let current = nextDay(from); current <= to; current = nextDay(current)) {
    if (isBusinessDay(current)) count += 1;
  }
  return count;
}
