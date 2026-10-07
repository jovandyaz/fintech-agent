import { describe, expect, it } from 'vitest';

import { hasCommitment } from './commitments.js';

describe('hasCommitment', () => {
  it('finds the promise and completed-action verbs of 02 G5', () => {
    for (const text of [
      'Tranquila, te reembolsaremos el cargo.',
      'Te devolveremos tu dinero.',
      'Hoy te devolvemos el monto.',
      'Abonaremos el importe a tu cuenta.',
      'Te garantizamos una respuesta.',
      'Ya abrimos tu aclaración.',
      'ya escalamos tu caso',
      'Ya enviamos el comprobante.',
      'Ya reembolsamos el cargo.',
      'En 3 días te depositamos.',
      'en 48 horas hábiles te llamamos',
    ]) {
      expect(hasCommitment(text), text).toBe(true);
    }
  });

  it('reads through case, accents and invisible characters', () => {
    expect(hasCommitment('TE REEMBOLSAREMOS')).toBe(true);
    expect(hasCommitment('te reem\u200bbolsaremos')).toBe(true);
    expect(hasCommitment('Ya Envíamos el CEP')).toBe(true);
  });

  it('lets a negation that governs the verb cancel the match', () => {
    expect(hasCommitment('No podemos hacer un reembolso.')).toBe(false);
    expect(hasCommitment('No te reembolsaremos este cargo.')).toBe(false);
    expect(hasCommitment('Nunca te garantizamos un plazo.')).toBe(false);
    expect(hasCommitment('No te vamos a reembolsar ese cargo.')).toBe(false);
    expect(hasCommitment('No le reembolsaremos el cargo.')).toBe(false);
  });

  it('does not let a negation of another clause or verb cancel the match', () => {
    expect(hasCommitment('No te preocupes, te reembolsaremos.')).toBe(true);
    expect(hasCommitment('No es algo que ahora mismo te devolveremos')).toBe(
      true,
    );
  });

  it('matches verbs, not stems', () => {
    expect(
      hasCommitment('Puedes solicitar un reembolso o una devolución.'),
    ).toBe(false);
    expect(hasCommitment('El abono depende del dictamen.')).toBe(false);
  });
});

describe('hasCommitment, wider forms', () => {
  it('finds the listed verbs in every person and periphrasis', () => {
    for (const text of [
      'Le reembolsaremos los $1,250.00.',
      'Les devolveremos el importe.',
      'Reembolsaremos el cargo.',
      'Garantizamos la devolución.',
      'Te vamos a reembolsar mañana.',
      'Le vamos a devolver su dinero.',
      'Dentro de 2 días te depositamos.',
      'En 2 días, te avisamos.',
      'En 48 horas tendrás tu dinero.',
    ]) {
      expect(hasCommitment(text), text).toBe(true);
    }
  });

  it('cancels only on a negation that governs the verb', () => {
    expect(
      hasCommitment('No te preocupes que te reembolsaremos tu dinero'),
    ).toBe(true);
    expect(hasCommitment('No dudes que te devolveremos el cargo')).toBe(true);
    expect(hasCommitment('no creo que te devolveremos')).toBe(true);
  });
});

describe('hasCommitment, deadlines in any unit', () => {
  it('finds a deadline promise with a singular or short unit', () => {
    for (const text of [
      'En 1 día hábil te avisamos.',
      'En un día hábil te avisamos.',
      'En 24h te depositamos el monto.',
      'En 24h te avisamos.',
      'Dentro de 1 mes recibirás tu dinero.',
      'Hoy te depositamos el monto.',
    ]) {
      expect(hasCommitment(text), text).toBe(true);
    }
  });
});

describe('hasCommitment, present tense without a pronoun', () => {
  it('finds a present-tense promise with or without a deadline', () => {
    for (const text of [
      'En 3 días hábiles abonamos el monto a tu cuenta.',
      'En 24h depositamos tu dinero.',
      'Devolvemos el monto completo.',
      'En 2 días enviamos el comprobante.',
    ]) {
      expect(hasCommitment(text), text).toBe(true);
    }
    expect(hasCommitment('No abonamos cargos en disputa.')).toBe(false);
  });
});

describe('hasCommitment, pronouns before a deadline verb', () => {
  it('finds a deadline promise with an object or reflexive pronoun', () => {
    for (const text of [
      'En 48 horas lo resolvemos.',
      'En 2 días se lo enviamos.',
      'En 24 horas nos comunicamos contigo.',
    ]) {
      expect(hasCommitment(text), text).toBe(true);
    }
  });
});

describe('hasCommitment, the units the number reader knows', () => {
  it('finds a deadline in years, minutes or hours however written', () => {
    for (const text of [
      'En 1 año recibirás tu dinero.',
      'En 30 minutos te llamamos.',
      'En 2 hrs te avisamos.',
    ]) {
      expect(hasCommitment(text), text).toBe(true);
    }
  });
});

describe('hasCommitment, the forms 02 G5 names', () => {
  it('finds "vamos a" + infinitive with no pronoun, a pronoun pair or an enclitic', () => {
    for (const text of [
      'Vamos a reembolsar el cargo.',
      'Te lo vamos a devolver.',
      'Se lo vamos a reembolsar mañana.',
      'Vamos a devolverte tu dinero.',
      'Vamos a abonárselo hoy.',
    ]) {
      expect(hasCommitment(text), text).toBe(true);
    }
    expect(hasCommitment('No vamos a reembolsar ese cargo.')).toBe(false);
  });

  it('finds "ya" + a completed action with a pronoun in between', () => {
    for (const text of [
      'Ya te enviamos el CEP.',
      'Ya le abrimos una aclaración.',
      'Ya se lo escalamos al área de fraudes.',
    ]) {
      expect(hasCommitment(text), text).toBe(true);
    }
  });
});

describe('hasCommitment, any person of the listed verbs', () => {
  it('finds a promise in the singular, the third person or with "ir a"', () => {
    for (const text of [
      'Hola, te reembolsarán el cargo mañana.',
      'Se te devolverá tu dinero.',
      'Te reembolsaré el cargo.',
      'Le abonarán el importe hoy.',
      'Te lo depositarán el lunes.',
      'Te garantizo una respuesta.',
      'Te van a reembolsar el cargo.',
      'Mañana te devuelven el dinero.',
      'El banco te abona el monto.',
    ]) {
      expect(hasCommitment(text), text).toBe(true);
    }
    expect(hasCommitment('No te reembolsarán ese cargo.')).toBe(false);
  });

  it('reads through letters from another script that look Latin', () => {
    expect(hasCommitment('te rеembolsaremos')).toBe(true);
  });
});

describe('hasCommitment, deadlines given as a range', () => {
  it.each([
    'En 2-3 días hábiles te llega tu reembolso.',
    'Entre 2 y 3 días te llega el abono.',
    'En 2 a 3 días tendrás tu dinero.',
    'Dentro de 2–3 días recibirás tu dinero.',
  ])('finds "%s"', (text) => {
    expect(hasCommitment(text)).toBe(true);
  });
});

describe('hasCommitment, deadlines with decimals or thousands', () => {
  it.each([
    'En 1,5 días te llega el abono.',
    'En 1.5 días tendrás tu dinero.',
    'En 1.000 días tendrás tu dinero.',
    'En mil días te llega el abono.',
  ])('finds "%s"', (text) => {
    expect(hasCommitment(text)).toBe(true);
  });
});
