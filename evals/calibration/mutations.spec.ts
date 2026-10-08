import { describe, expect, it } from 'vitest';

import { CLEAN_DRAFT } from '../judge/controls.js';
import { ADDED_PROMISES, mutate, mutationNegatives } from './mutations.js';
import type { CalibrationRow } from './rows.js';

const KEEP_ORDER = () => 0.9999;

const DATED =
  'Hola {{nombre}}, registramos tu aclaración. Te responderemos a más tardar el 22 de noviembre de 2026.';

const row = (case_id: string, draft_reply: string): CalibrationRow => ({
  row_id: `variant-A:${case_id}`,
  case_id,
  variant: 'variant-A',
  source: 'run',
  judge_input: { ...CLEAN_DRAFT, draft_reply },
});

describe('mutation negatives (03 §Judge validation step 3)', () => {
  it('changes one date in a dated draft, and nothing else', () => {
    const mutated = mutate(row('CARD-UNREC-01', DATED), 'changed_date');
    expect(mutated?.judge_input.draft_reply).toBe(
      DATED.replace('22 de noviembre', '25 de noviembre'),
    );
    expect(mutated?.judge_input.cited_chunks).toEqual(CLEAN_DRAFT.cited_chunks);
  });

  it('changes a date the harness filled as dd/mm/aaaa, keeping its form', () => {
    const filled =
      'Hola Ana, registramos tu aclaración. Te responderemos a más tardar el 22/11/2026 y el 07/10/2026.';
    expect(
      mutate(row('CARD-UNREC-01', filled), 'changed_date')?.judge_input
        .draft_reply,
    ).toBe(filled.replace('22/11/2026', '25/11/2026'));
  });

  it('changes the first date of either form, and only that one', () => {
    const mixed =
      'Recibimos tu reporte el 5 de octubre; te responderemos a más tardar el 21/11/2026.';
    expect(
      mutate(row('CARD-UNREC-01', mixed), 'changed_date')?.judge_input
        .draft_reply,
    ).toBe(mixed.replace('5 de octubre', '8 de octubre'));
    const numericFirst =
      'Tu folio AC-12/34/5678-X; registrado el 07/10/2026, respuesta el 9 de noviembre.';
    expect(
      mutate(row('CARD-UNREC-01', numericFirst), 'changed_date')?.judge_input
        .draft_reply,
    ).toBe(numericFirst.replace('07/10/2026', '10/10/2026'));
  });

  it('cannot change the date of a draft with none', () => {
    expect(
      mutate(row('GEN-01', 'Hola, no hay fecha.'), 'changed_date'),
    ).toBeNull();
  });

  it('drops every citation and keeps the draft', () => {
    const mutated = mutate(row('CARD-UNREC-01', DATED), 'dropped_citation');
    expect(mutated?.judge_input.cited_chunks).toEqual([]);
    expect(mutated?.judge_input.draft_reply).toBe(DATED);
  });

  it('cannot drop a citation from a draft that cites nothing', () => {
    const uncited = {
      ...row('GEN-01', 'Hola.'),
      judge_input: { ...CLEAN_DRAFT, draft_reply: 'Hola.', cited_chunks: [] },
    };
    expect(mutate(uncited, 'dropped_citation')).toBeNull();
  });

  it('appends a promise no policy supports', () => {
    const mutated = mutate(row('CARD-UNREC-01', DATED), 'added_promise');
    expect(mutated?.judge_input.draft_reply).toBe(
      `${DATED} ${ADDED_PROMISES[0]}`,
    );
  });

  it('marks each negative as a mutation of its row, with its own id', () => {
    const mutated = mutate(row('CARD-UNREC-01', DATED), 'added_promise');
    expect(mutated).toMatchObject({
      row_id: 'variant-A:CARD-UNREC-01:added_promise',
      source: 'mutation',
      mutation: 'added_promise',
      case_id: 'CARD-UNREC-01',
    });
  });

  it('makes the target number of negatives, rotating the defects, one per run row', () => {
    const rows = ['A', 'B', 'C', 'D', 'E'].map((id) => row(id, DATED));
    const negatives = mutationNegatives(rows, 4, KEEP_ORDER);
    expect(negatives.map(({ mutation }) => mutation)).toEqual([
      'changed_date',
      'dropped_citation',
      'added_promise',
      'changed_date',
    ]);
    expect(new Set(negatives.map(({ case_id }) => case_id)).size).toBe(4);
  });

  it('tries the next defect on a draft the current one does not fit', () => {
    const rows = [row('A', 'Sin fecha.'), row('B', DATED)];
    expect(
      mutationNegatives(rows, 2, KEEP_ORDER).map(({ case_id, mutation }) => [
        case_id,
        mutation,
      ]),
    ).toEqual([
      ['A', 'dropped_citation'],
      ['B', 'added_promise'],
    ]);
  });

  it('never stalls on drafts without a date, which the prompt fills by placeholder', () => {
    const undated = ['A', 'B', 'C', 'D'].map((id) =>
      row(id, 'Hola {{nombre}}.'),
    );
    expect(mutationNegatives(undated, 4, KEEP_ORDER)).toHaveLength(4);
  });

  it('takes the run rows in shuffled order, so negatives spread over cases', () => {
    const rows = ['A', 'B', 'C'].map((id) => row(id, DATED));
    expect(
      mutationNegatives(rows, 1, () => 0).map(({ case_id }) => case_id),
    ).not.toEqual(['A']);
  });

  it('varies the added promise, so planted rows do not share one sentence', () => {
    const rows = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => row(id, 'Hola.'));
    const promises = mutationNegatives(rows, 6, KEEP_ORDER)
      .filter(({ mutation }) => mutation === 'added_promise')
      .map(({ judge_input }) => judge_input.draft_reply);
    expect(new Set(promises).size).toBe(promises.length);
    expect(promises.length).toBeGreaterThan(1);
  });

  it('mutates only run rows, never a negative again', () => {
    const negative = mutate(row('A', DATED), 'added_promise')!;
    expect(mutationNegatives([negative], 1, KEEP_ORDER)).toEqual([]);
  });
});
