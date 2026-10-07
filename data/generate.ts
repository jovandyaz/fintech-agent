import {
  TICKET_ID_PREFIX,
  type CardTx,
  type Customer,
  type KycLevel,
  type SpeiTx,
  type Transaction,
  type TxStatus,
  type WebhookEvent,
} from '@fintech-agent/contracts';

import {
  SCENARIOS,
  type CustomerLookup,
  type ScenarioId,
} from './scenarios.js';

export const DATASET_SEED = 20261005;

const CUSTOMER_COUNT = 20;
const FILLER_PER_CUSTOMER = 9;
const RETURNED_FILLER_EVERY = 5;
const DECIMAL_BASE = 10;
const MAX_DECIMAL_DIGIT = 9;
const CENTS = 100;
const CLABE_WEIGHTS = [3, 7, 1] as const;
const CLABE_ACCOUNT_DIGITS = 11;
const ALBO_CLABE_PREFIX = '646180';
const COUNTERPARTY_BANK_PREFIXES = ['002180', '012180', '014180', '072180'];
const CARD_BIN = '476134';
const CARD_BODY_DIGITS = 9;
const PHONE_PREFIX = '55';
const PHONE_BODY_DIGITS = 8;
const REFERENCE_DIGITS = 7;
const TRACKING_DIGITS = 10;
const ID_PAD = 3;
const PAD2 = 2;
const SETTLE_DELAY_MS = 3_000;
const RETURN_DELAY_MS = 40_000;
const MX_OFFSET_MS = 6 * 60 * 60 * 1000;
const ISO_SECONDS_CHARS = 19;
const ISO_DATE_CHARS = 10;
const FILLER_FROM = Date.parse('2026-08-01T08:00:00-06:00');
const FILLER_TO = Date.parse('2026-09-28T20:00:00-06:00');
const SHARE_SPEI_IN = 0.3;
const SHARE_SPEI_OUT = 0.6;
const SHARE_CARD_NOT_PRESENT = 0.2;
const SHARE_CARD_DECLINED = 0.08;
const SPEI_AMOUNT = { min: 150, max: 18_000 } as const;
const CARD_AMOUNT = { min: 35, max: 3_500 } as const;
const RFC_HOMOCLAVE_CHARS = 3;
const CURP_CONSONANTS = 3;
const BIRTH_YEAR = { min: 1970, max: 2003 } as const;
const MONTHS = 12;
const DAYS = 28;
const YEAR_DIGITS = 2;
const ALPHANUMERIC = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';
const KYC_DEFAULTS: KycLevel[] = ['N2', 'N3'];
const SETTLED: TxStatus = 'settled';
const REVERSAL_COUNTERPARTY = 'Devolución SPEI';

const MULBERRY_INCREMENT = 0x6d2b79f5;
const MULBERRY_SHIFTS = [15, 7, 14] as const;
const MULBERRY_MIX = 61;
const UINT32_RANGE = 2 ** 32;

const FIRST_NAMES = [
  ['Ana', 'M'],
  ['Luis', 'H'],
  ['Sofía', 'M'],
  ['Carlos', 'H'],
  ['Valeria', 'M'],
  ['Jorge', 'H'],
  ['Daniela', 'M'],
  ['Miguel', 'H'],
  ['Fernanda', 'M'],
  ['Ricardo', 'H'],
  ['Paola', 'M'],
  ['Andrés', 'H'],
  ['Camila', 'M'],
  ['Diego', 'H'],
  ['Mariana', 'M'],
  ['Héctor', 'H'],
  ['Lucía', 'M'],
  ['Emilio', 'H'],
  ['Regina', 'M'],
  ['Tomás', 'H'],
] as const;
const LAST_NAMES = [
  'Hernández',
  'García',
  'Martínez',
  'López',
  'González',
  'Pérez',
  'Rodríguez',
  'Sánchez',
  'Ramírez',
  'Cruz',
  'Flores',
  'Gómez',
  'Morales',
  'Vázquez',
  'Reyes',
  'Jiménez',
  'Torres',
  'Díaz',
  'Gutiérrez',
  'Ruiz',
];
const COUNTERPARTIES = [
  'Inmobiliaria Roble SA de CV',
  'Juan Carlos Méndez Ortiz',
  'Papelería La Estrella',
  'Laura Patricia Nava Soto',
  'Servicios Contables Delta',
  'Roberto Aguilar Peña',
  'Escuela Montessori Coyoacán',
  'Gabriela Ibarra Luna',
];
const CARD_PRESENT_MERCHANTS = [
  ['WALMART COYOACAN', 'Walmart'],
  ['OXXO NARVARTE', 'OXXO'],
  ['STARBUCKS REFORMA', 'Starbucks'],
  ['SORIANA TLALPAN', 'Soriana'],
  ['FARMACIAS GDL', 'Farmacias Guadalajara'],
  ['PEMEX ES TLALPAN', 'Pemex'],
  ['CINEPOLIS PERISUR', 'Cinépolis'],
  ['LA COMER DEL VALLE', 'La Comer'],
] as const;
const CARD_NOT_PRESENT_MERCHANTS = [
  ['NETFLIX.COM', 'Netflix'],
  ['SPOTIFY MX', 'Spotify'],
  ['UBER *TRIP', 'Uber'],
  ['DIDI FOOD', 'DiDi Food'],
  ['RAPPI MX', 'Rappi'],
  ['MERCADOLIBRE', 'Mercado Libre'],
] as const;

type Random = () => number;
type Merchant = readonly [string, string];

function mulberry32(seed: number): Random {
  const [first, second, third] = MULBERRY_SHIFTS;
  let state = seed >>> 0;
  return () => {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> first), t | 1);
    t ^= t + Math.imul(t ^ (t >>> second), t | MULBERRY_MIX);
    return ((t ^ (t >>> third)) >>> 0) / UINT32_RANGE;
  };
}

const int = (random: Random, min: number, max: number): number =>
  min + Math.floor(random() * (max - min + 1));

function pick<T>(random: Random, items: readonly T[]): T {
  const item = items[int(random, 0, items.length - 1)];
  if (item === undefined) throw new Error('pick from an empty list');
  return item;
}

const digits = (random: Random, count: number): string =>
  Array.from({ length: count }, () =>
    String(int(random, 0, MAX_DECIMAL_DIGIT)),
  ).join('');

const chars = (random: Random, alphabet: string, count: number): string =>
  Array.from({ length: count }, () => pick(random, [...alphabet])).join('');

const amount = (random: Random, range: { min: number; max: number }): number =>
  Math.round((range.min + random() * (range.max - range.min)) * CENTS) / CENTS;

const pad = (n: number, width: number): string =>
  String(n).padStart(width, '0');

const isoMx = (ms: number): string =>
  `${new Date(ms - MX_OFFSET_MS).toISOString().slice(0, ISO_SECONDS_CHARS)}-06:00`;

function clabeControl(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const weight = CLABE_WEIGHTS[i % CLABE_WEIGHTS.length] ?? 1;
    sum += (Number(body[i]) * weight) % DECIMAL_BASE;
  }
  return String((DECIMAL_BASE - (sum % DECIMAL_BASE)) % DECIMAL_BASE);
}

const clabe = (random: Random, prefix: string): string => {
  const body = prefix + digits(random, CLABE_ACCOUNT_DIGITS);
  return body + clabeControl(body);
};

function luhnCheckDigit(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let digit = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > MAX_DECIMAL_DIGIT) digit -= MAX_DECIMAL_DIGIT;
    }
    sum += digit;
  }
  return String((DECIMAL_BASE - (sum % DECIMAL_BASE)) % DECIMAL_BASE);
}

const ascii = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/Ñ/gi, 'X')
    .toUpperCase();

function customer(random: Random, index: number): Customer {
  const [firstName, sex] = FIRST_NAMES[index] ?? FIRST_NAMES[0];
  const paternal = pick(random, LAST_NAMES);
  const maternal = pick(random, LAST_NAMES);
  const p = ascii(paternal);
  const m = ascii(maternal);
  const f = ascii(firstName);
  const year = int(random, BIRTH_YEAR.min, BIRTH_YEAR.max) % CENTS;
  const birth = `${pad(year, YEAR_DIGITS)}${pad(int(random, 1, MONTHS), PAD2)}${pad(int(random, 1, DAYS), PAD2)}`;
  const stem = `${p.slice(0, 2)}${m.charAt(0)}${f.charAt(0)}${birth}`;
  const pan = CARD_BIN + digits(random, CARD_BODY_DIGITS);
  return {
    id: `cus_${pad(index + 1, PAD2)}`,
    first_name: firstName,
    last_names: `${paternal} ${maternal}`,
    rfc: stem + chars(random, ALPHANUMERIC, RFC_HOMOCLAVE_CHARS),
    curp: `${stem}${sex}DF${chars(random, CONSONANTS, CURP_CONSONANTS)}${chars(random, CONSONANTS, 1)}${digits(random, 1)}`,
    email: `${f.toLowerCase()}.${p.toLowerCase()}@example.com`,
    phone: PHONE_PREFIX + digits(random, PHONE_BODY_DIGITS),
    clabe: clabe(random, ALBO_CLABE_PREFIX),
    card_pan: pan + luhnCheckDigit(pan),
    card_status: 'active',
    kyc_level: pick(random, KYC_DEFAULTS),
    account_status: 'active',
  };
}

interface FillerContext {
  random: Random;
  owner: Customer;
  next: () => number;
}

function fillerSpei(
  { random, owner, next }: FillerContext,
  type: SpeiTx['type'],
  at: number,
): SpeiTx {
  return {
    id: `tx_f${pad(next(), ID_PAD)}`,
    customer_id: owner.id,
    type,
    status: SETTLED,
    amount: amount(random, SPEI_AMOUNT),
    created_at: isoMx(at),
    counterparty_name: pick(random, COUNTERPARTIES),
    counterparty_clabe: clabe(random, pick(random, COUNTERPARTY_BANK_PREFIXES)),
    tracking_key: `BNET${isoMx(at).slice(0, ISO_DATE_CHARS).replaceAll('-', '')}${digits(random, TRACKING_DIGITS)}`,
    numeric_reference: digits(random, REFERENCE_DIGITS),
    settled_at: isoMx(at + SETTLE_DELAY_MS),
    hold_reason: null,
    return_reason: null,
    returned_at: null,
    reversal_credit_id: null,
    reverses_tx_id: null,
    reject_reason: null,
    cep_available: true,
  };
}

function fillerCard(
  { random, owner, next }: FillerContext,
  at: number,
  notPresentLeft: Merchant[],
): CardTx {
  const remote = random() < SHARE_CARD_NOT_PRESENT && notPresentLeft.length > 0;
  const [descriptor, brand] = remote
    ? (notPresentLeft.splice(int(random, 0, notPresentLeft.length - 1), 1)[0] ??
      CARD_NOT_PRESENT_MERCHANTS[0])
    : pick(random, CARD_PRESENT_MERCHANTS);
  const declined = random() < SHARE_CARD_DECLINED;
  return {
    id: `tx_f${pad(next(), ID_PAD)}`,
    customer_id: owner.id,
    type: 'card_purchase',
    status: declined ? 'rejected' : SETTLED,
    amount: amount(random, CARD_AMOUNT),
    created_at: isoMx(at),
    merchant_descriptor: descriptor,
    merchant_brand: brand,
    channel: remote ? 'card_not_present' : 'card_present',
    auth_factors: remote ? 1 : 2,
    decline_reason: declined ? 'insufficient_funds' : null,
  };
}

function reversalOf(tx: SpeiTx, id: string): SpeiTx {
  const at = Date.parse(tx.created_at) + RETURN_DELAY_MS;
  return {
    ...tx,
    id,
    type: 'spei_in',
    status: SETTLED,
    created_at: isoMx(at),
    settled_at: isoMx(at),
    counterparty_name: REVERSAL_COUNTERPARTY,
    return_reason: null,
    returned_at: null,
    reversal_credit_id: null,
    reverses_tx_id: tx.id,
    cep_available: true,
  };
}

function fillerFor(context: FillerContext, index: number): Transaction[] {
  const { random, next } = context;
  const notPresentLeft: Merchant[] = [...CARD_NOT_PRESENT_MERCHANTS];
  const times = Array.from({ length: FILLER_PER_CUSTOMER }, () =>
    int(random, FILLER_FROM, FILLER_TO),
  ).sort((a, b) => a - b);
  const out: Transaction[] = [];
  let needsReturn = index % RETURNED_FILLER_EVERY === 0;
  for (const at of times) {
    const roll = random();
    const isSpeiOut =
      needsReturn || (roll >= SHARE_SPEI_IN && roll < SHARE_SPEI_OUT);
    if (!isSpeiOut) {
      out.push(
        roll < SHARE_SPEI_IN
          ? fillerSpei(context, 'spei_in', at)
          : fillerCard(context, at, notPresentLeft),
      );
      continue;
    }
    const tx = fillerSpei(context, 'spei_out', at);
    if (!needsReturn) {
      out.push(tx);
      continue;
    }
    const reversalId = `tx_r${pad(next(), ID_PAD)}`;
    const returned: SpeiTx = {
      ...tx,
      status: 'returned',
      settled_at: null,
      cep_available: false,
      return_reason: 'beneficiario_no_coincide',
      returned_at: isoMx(at + RETURN_DELAY_MS),
      reversal_credit_id: reversalId,
    };
    out.push(returned, reversalOf(returned, reversalId));
    needsReturn = false;
  }
  return out;
}

export interface GeneratedFixture {
  scenario_id: ScenarioId;
  event: WebhookEvent;
}

export interface Dataset {
  customers: Customer[];
  transactions: Transaction[];
  fixtures: GeneratedFixture[];
}

/**
 * Builds the whole synthetic core: every scenario is planted first under its
 * fixed ids, then seeded filler dated before any scenario. The same seed
 * always yields the same dataset.
 */
export function generateDataset(seed: number): Dataset {
  const random = mulberry32(seed);
  const customers = Array.from({ length: CUSTOMER_COUNT }, (_, i) =>
    customer(random, i),
  );
  const byId = new Map(customers.map((c) => [c.id, c]));
  const lookup: CustomerLookup = (id) => {
    const found = byId.get(id);
    if (!found) throw new Error(`unknown customer ${id}`);
    return found;
  };
  for (const scenario of SCENARIOS) {
    const owner = lookup(scenario.customer_id);
    if (scenario.card_status) owner.card_status = scenario.card_status;
    if (scenario.kyc_level) owner.kyc_level = scenario.kyc_level;
  }

  const planted: Transaction[] = SCENARIOS.flatMap((scenario) =>
    scenario.transactions.map((tx): Transaction => ({
      ...tx,
      customer_id: scenario.customer_id,
    })),
  );
  let counter = 0;
  const next = (): number => ++counter;
  const filler = customers.flatMap((owner, i) =>
    fillerFor({ random, owner, next }, i),
  );

  const fixtures = SCENARIOS.map((scenario) => ({
    scenario_id: scenario.id,
    event: {
      event_id: `evt-${scenario.id.toLowerCase()}`,
      ticket_id: `${TICKET_ID_PREFIX}${scenario.id.toLowerCase()}`,
      customer_id: scenario.customer_id,
      text: scenario.text(lookup),
      created_at: scenario.received_at,
    },
  }));

  return { customers, transactions: [...planted, ...filler], fixtures };
}
