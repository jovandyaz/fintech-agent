import { addBusinessDays, addNaturalDays, localDateOf } from '../calendar.js';

/** The placeholders a draft may carry (02 G5); the harness fills them after validation. */
export const PLACEHOLDERS = [
  'nombre',
  'folio',
  'fecha_recepcion',
  'fecha_limite_dictamen',
  'fecha_limite_abono',
  'compromiso_dictamen',
  'compromiso_abono',
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

// LTOSF art. 23: the written answer to an aclaración, in natural days.
const DICTAMEN_NATURAL_DAYS = 45;
// Banxico Circ. 12/2018 18.a: the credit of an unrecognized charge.
const ABONO_BUSINESS_DAYS = 2;

const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
// The name is filled after validation, so a figure or a promise inside it
// would reach the reply unread by UNGROUNDED_NUMBER and COMMITMENT_IN_REPLY.
const PERSON_NAME = /^\p{L}[\p{L} '’.-]*$/u;

// Approved wording, rendered only when its predicate held at validation.
// Neither holds a phone number or a link, so a filled reply still passes
// PII_IN_REPLY and LINK_IN_REPLY.
const COMMITMENTS = {
  compromiso_dictamen:
    'Te daremos una respuesta por escrito a más tardar el {{fecha_limite_dictamen}}. Si no estás de acuerdo con ella, puedes acudir a la CONDUSEF.',
  compromiso_abono:
    'Te abonaremos el importe del cargo a más tardar el {{fecha_limite_abono}}, mientras resolvemos tu aclaración.',
} as const satisfies Partial<Record<Placeholder, string>>;

// dd/mm/aaaa: the masker reads it as a date. A long Spanish date leaves its
// day as loose digits that, with an amount in the same reply, cross the
// masker's message budget and fail PII_IN_REPLY after filling.
const calendarDate = (day: string): string => {
  const [year, month, dayOfMonth] = day.split('-');
  return `${dayOfMonth}/${month}/${year}`;
};

function personName(firstName: string | null): string {
  if (firstName === null) {
    throw new Error('{{nombre}} without a customer the run saw');
  }
  // NFC first: a decomposed accent is a letter plus a mark, not \p{L}.
  const name = firstName.normalize('NFC');
  if (!PERSON_NAME.test(name)) {
    throw new Error('{{nombre}} from a customer name that is not a name');
  }
  return name;
}

/** Whether a name is one of the approved placeholders. */
export const isPlaceholder = (name: string): name is Placeholder =>
  (PLACEHOLDERS as readonly string[]).includes(name);

/** Every `{{…}}` name in a text, in order, known or not. */
export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map(([, name]) => name!);
}

export interface FillContext {
  receivedAt: Date;
  folio: string;
  /** From the run's `get_customer` output; null when the run did not call it. */
  firstName: string | null;
}

/**
 * Fills every placeholder from `cases.received_at` with the bank calendar
 * (02 G5: the model never computes a date or a promise). Throws on a
 * placeholder it cannot fill, which validation rules out beforehand, on a
 * customer name with anything but letters, spaces and `'.-`, and
 * `CalendarRangeError` past the listed years.
 */
export function fillPlaceholders(text: string, context: FillContext): string {
  const received = localDateOf(context.receivedAt);
  const values = (name: Placeholder): string => {
    switch (name) {
      case 'nombre':
        return personName(context.firstName);
      case 'folio':
        return context.folio;
      case 'fecha_recepcion':
        return calendarDate(received);
      case 'fecha_limite_dictamen':
        return calendarDate(addNaturalDays(received, DICTAMEN_NATURAL_DAYS));
      case 'fecha_limite_abono':
        return calendarDate(addBusinessDays(received, ABONO_BUSINESS_DAYS));
      case 'compromiso_dictamen':
      case 'compromiso_abono':
        return fill(COMMITMENTS[name]);
    }
  };
  const fill = (template: string): string =>
    template.replace(PLACEHOLDER, (_, name: string) => {
      if (!isPlaceholder(name))
        throw new Error(`unknown placeholder {{${name}}}`);
      return values(name);
    });
  return fill(text);
}
