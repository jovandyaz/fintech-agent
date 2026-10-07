/** "a la" or "a las" right before an hour, in folded text. */
export const CLOCK_CUE = String.raw`\ba\slas?\s`;
export const LAST_HOUR = 23;
export const MINUTES_PER_HOUR = 60;

/** An hour of a 24-hour clock, 0 to 23, as regex source. */
export const HOUR_24 = String.raw`(?:[01]?\d|2[0-3])`;
/** An integer no clock shows as an hour: 24 to 99, or three digits or more. */
export const PAST_LAST_HOUR = String.raw`(?:2[4-9]|[3-9]\d|\d{3,})`;
/** An hour of a 12-hour clock, 1 to 12, as regex source. */
export const HOUR_12 = String.raw`(?:1[0-2]|0?[1-9])`;
/** Minutes as a clock writes them, always two digits. */
export const MINUTE = String.raw`[0-5]\d`;
/** Minutes as said after "y", one or two digits. */
export const SPOKEN_MINUTE = String.raw`[0-5]?\d`;

/** The parts of the day a time names after "de la", folded. */
export const DAY_PARTS = ['tarde', 'noche', 'manana', 'madrugada'] as const;
export type DayPart = (typeof DAY_PARTS)[number];

/**
 * Where minutes said after "y" may end: punctuation, the end, or "de la"
 * and a part of the day. Anywhere else the figure is no minutes, or "a las
 * 3 y 50 pesos" would hide 50 pesos behind 03:50.
 */
export const MINUTES_END = String.raw`\s?(?:$|[,.;:!?)]|de\sla\s(?:${DAY_PARTS.join('|')})\b)`;
