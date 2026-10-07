import { describe, expect, it } from 'vitest';

import {
  BANK_CALENDAR,
  CalendarRangeError,
  addBusinessDays,
  addNaturalDays,
  businessDaysBetween,
  localDateOf,
} from './calendar.js';

describe('localDateOf', () => {
  it('reads the calendar day in Mexico City, not in UTC', () => {
    expect(localDateOf(new Date('2026-10-07T05:30:00Z'))).toBe('2026-10-06');
    expect(localDateOf(new Date('2026-10-07T06:00:00Z'))).toBe('2026-10-07');
  });
});

describe('addBusinessDays', () => {
  it('skips the weekend', () => {
    expect(addBusinessDays('2026-10-09', 2)).toBe('2026-10-13');
  });

  it('counts from the next business day when the start is a Saturday', () => {
    expect(addBusinessDays('2026-10-10', 2)).toBe('2026-10-13');
  });

  it('skips Holy Thursday and Good Friday', () => {
    expect(addBusinessDays('2026-04-01', 1)).toBe('2026-04-06');
  });

  it('skips a Monday holiday', () => {
    expect(addBusinessDays('2026-11-13', 1)).toBe('2026-11-17');
  });

  it('crosses the year boundary over New Year', () => {
    expect(addBusinessDays('2026-12-31', 1)).toBe('2027-01-04');
  });

  it('refuses to answer outside the years the calendar lists', () => {
    expect(() => addBusinessDays('2027-12-31', 1)).toThrow(CalendarRangeError);
    expect(() => businessDaysBetween('2025-12-30', '2026-01-02')).toThrow(
      CalendarRangeError,
    );
  });
});

describe('addNaturalDays', () => {
  it('counts every day, holidays and weekends included', () => {
    expect(addNaturalDays('2026-11-20', 45)).toBe('2027-01-04');
  });
});

describe('businessDaysBetween', () => {
  it('counts the business days after the first date up to the second', () => {
    expect(businessDaysBetween('2026-10-09', '2026-10-12')).toBe(1);
    expect(businessDaysBetween('2026-04-01', '2026-04-06')).toBe(1);
    expect(businessDaysBetween('2026-10-05', '2026-10-08')).toBe(3);
  });

  it('is zero on the same day and when the second date is earlier', () => {
    expect(businessDaysBetween('2026-10-07', '2026-10-07')).toBe(0);
    expect(businessDaysBetween('2026-10-08', '2026-10-07')).toBe(0);
  });
});

describe('BANK_CALENDAR', () => {
  it('lists eleven sorted days per year, each inside its year', () => {
    for (const [year, { days }] of Object.entries(BANK_CALENDAR.years)) {
      expect(days).toHaveLength(11);
      expect([...days].sort()).toEqual(days);
      expect(days.every((day) => day.startsWith(`${year}-`))).toBe(true);
    }
  });
});
