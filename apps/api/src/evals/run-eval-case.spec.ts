import { describe, expect, it } from 'vitest';

import { acceptedDraftOf } from './run-eval-case.js';

const DRAFT = 'Hola {{nombre}}, registramos tu aclaración con folio {{folio}}.';
const PASSED = { outcome: 'passed', codes: [] };
const FAILED = { outcome: 'failed', codes: ['COMMITMENT_IN_REPLY'] };

describe('acceptedDraftOf (03 §Judge validation: the draft the judge reads)', () => {
  it('has no draft for a run that persisted no reply, whatever its last model answer says', () => {
    expect(
      acceptedDraftOf({
        draft_reply: null,
        model_outputs: [{ draft_reply: 'Te reembolsaremos hoy.' }],
        validations: [FAILED],
      }),
    ).toBeNull();
  });

  it("reads the accepted model answer's draft, placeholders unfilled", () => {
    expect(
      acceptedDraftOf({
        draft_reply:
          'Hola Ana, registramos tu aclaración con folio AC-H5HD-08ZM.',
        model_outputs: [
          { draft_reply: 'Te reembolsaremos hoy.' },
          { draft_reply: DRAFT },
        ],
        validations: [FAILED, PASSED],
      }),
    ).toBe(DRAFT);
  });

  it('refuses a persisted reply whose last validation did not pass: its last model answer was not the accepted one', () => {
    expect(() =>
      acceptedDraftOf({
        draft_reply: 'Hola Ana.',
        model_outputs: [{ draft_reply: DRAFT }],
        validations: [FAILED],
      }),
    ).toThrow('accepted');
  });

  it('refuses a persisted reply whose last model answer carries no draft', () => {
    for (const model_outputs of [
      [],
      [{ draft_reply: '' }],
      [{ category: 'general_inquiry' }],
    ]) {
      expect(() =>
        acceptedDraftOf({
          draft_reply: 'Hola Ana.',
          model_outputs,
          validations: [PASSED],
        }),
      ).toThrow('accepted');
    }
  });
});
