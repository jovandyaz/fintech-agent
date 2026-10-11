import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { JudgeInput } from '@fintech-agent/api/evals';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { carryLabelFiles, carryLabels } from './carry.js';
import { mutate } from './mutations.js';
import {
  parseHumanLabels,
  toJsonl,
  type CalibrationRow,
  type HumanLabel,
  type LabelRow,
  type RowKey,
} from './rows.js';

const CASE = 'CARD-UNREC-01';
const FOLIO = 'AC-H5HD-08ZM';
const DEADLINE_45_DAYS_AFTER_THE_FIXTURE = '19/11/2026';
const customerSaw = (first_name: string) => ({
  tool: 'get_customer',
  output: {
    content: [{ type: 'text', text: JSON.stringify({ first_name }) }],
    isError: false,
  },
});
const TOOLS = [customerSaw('Ana')];
const CHUNKS = [
  { doc_id: 'pol-04', section: 'Plazos', text: 'Respondemos por escrito.' },
];

const UNFILLED =
  'Hola {{nombre}}, tu folio es {{folio}}. {{compromiso_dictamen}} Tu cargo del 5 de octubre sigue en revisión.';
const FILLED = `Hola Ana, tu folio es ${FOLIO}. Te daremos una respuesta por escrito a más tardar el ${DEADLINE_45_DAYS_AFTER_THE_FIXTURE}. Si no estás de acuerdo con ella, puedes acudir a la CONDUSEF. Tu cargo del 5 de octubre sigue en revisión.`;

const input = (draft_reply: string): JudgeInput => ({
  draft_reply,
  cited_chunks: CHUNKS,
  tool_outputs: TOOLS,
});

const runRow = (draft: string, caseId = CASE): CalibrationRow => ({
  row_id: `variant-A:${caseId}`,
  case_id: caseId,
  variant: 'variant-A',
  source: 'run',
  judge_input: input(draft),
});

const filesOf = (
  rows: readonly (CalibrationRow & { opaque: string })[],
): { keys: RowKey[]; rows: LabelRow[] } => ({
  keys: rows.map(({ opaque, case_id, variant, source, mutation }) => ({
    row_id: opaque,
    case_id,
    variant,
    source,
    ...(mutation ? { mutation } : {}),
  })),
  rows: rows.map(({ opaque, judge_input }) => ({
    row_id: opaque,
    judge_input,
  })),
});

const labelOf = (row_id: string, human_pass: boolean): HumanLabel => ({
  row_id,
  human_pass,
  reason: `label of ${row_id}`,
});

const shiftedFilled = mutate(runRow(FILLED), 'changed_date')!;
const shiftedUnfilled = mutate(runRow(UNFILLED), 'changed_date')!;

const OLD = {
  ...filesOf([
    { ...runRow(FILLED), opaque: 'row-005' },
    { ...runRow('Hola, revisamos tu caso.', 'GEN-01'), opaque: 'row-001' },
    { ...shiftedFilled, opaque: 'row-009' },
  ]),
  labels: [
    labelOf('row-005', true),
    labelOf('row-001', true),
    labelOf('row-009', false),
  ],
};
const FRESH = filesOf([
  { ...runRow(UNFILLED), opaque: 'row-002' },
  { ...shiftedUnfilled, opaque: 'row-007' },
]);

describe('carryLabels (pnpm eval:carry-labels, 03 §Judge validation)', () => {
  it('carries a label to the same row judged unfilled, when filling it as the harness did gives back the draft labeled', () => {
    const outcome = carryLabels({ old: OLD, fresh: FRESH });
    expect(outcome.carried).toEqual([{ from: 'row-005', to: 'row-002' }]);
    expect(outcome.labels).toEqual([
      { ...labelOf('row-005', true), row_id: 'row-002' },
    ]);
  });

  it('drops the label of a row that is no row any more: a run with no reply', () => {
    expect(carryLabels({ old: OLD, fresh: FRESH }).dropped).toEqual([
      'row-001',
    ]);
  });

  it('sends to relabel a changed_date row whose old shift hit a date the harness filled', () => {
    expect(shiftedFilled.judge_input.draft_reply).toContain('22/11/2026');
    expect(shiftedUnfilled.judge_input.draft_reply).toContain('8 de octubre');
    expect(carryLabels({ old: OLD, fresh: FRESH }).relabel).toEqual([
      'row-007',
    ]);
  });

  it('carries nothing when the evidence the judge reads changed, or the name the harness would fill differs', () => {
    const otherEvidence = {
      ...FRESH,
      rows: FRESH.rows.map((row) => ({
        ...row,
        judge_input: { ...row.judge_input, cited_chunks: [] },
      })),
    };
    expect(carryLabels({ old: OLD, fresh: otherEvidence }).carried).toEqual([]);
    const otherName = {
      ...FRESH,
      rows: FRESH.rows.map((row) => ({
        ...row,
        judge_input: {
          ...row.judge_input,
          tool_outputs: [customerSaw('Luis')],
        },
      })),
    };
    expect(carryLabels({ old: OLD, fresh: otherName }).relabel).toEqual([
      'row-002',
      'row-007',
    ]);
  });
});

describe('carryLabelFiles', () => {
  let oldDir: string;
  let dir: string;

  beforeEach(async () => {
    oldDir = await mkdtemp(join(tmpdir(), 'evals-carry-old-'));
    dir = await mkdtemp(join(tmpdir(), 'evals-carry-'));
    await writeFile(join(oldDir, 'key.jsonl'), toJsonl(OLD.keys));
    await writeFile(join(oldDir, 'to-label.jsonl'), toJsonl(OLD.rows));
    await writeFile(join(oldDir, 'labels.jsonl'), toJsonl(OLD.labels));
    await writeFile(join(dir, 'key.jsonl'), toJsonl(FRESH.keys));
    await writeFile(join(dir, 'to-label.jsonl'), toJsonl(FRESH.rows));
  });

  afterEach(async () => {
    await rm(oldDir, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the carried labels under the new ids and prints what it carried, dropped and left to relabel', async () => {
    const log: string[] = [];
    await carryLabelFiles({ oldDir, dir, log: (line) => log.push(line) });
    expect(
      parseHumanLabels(await readFile(join(dir, 'labels.jsonl'), 'utf8')),
    ).toEqual([{ ...labelOf('row-005', true), row_id: 'row-002' }]);
    expect(log).toEqual([
      'carried 1: row-005 → row-002',
      'dropped 1: row-001',
      'to relabel 1: row-007',
    ]);
  });

  it('refuses to write over labels already in the calibration directory', async () => {
    await writeFile(join(dir, 'labels.jsonl'), 'kept');
    await expect(
      carryLabelFiles({ oldDir, dir, log: () => undefined }),
    ).rejects.toThrow('labels.jsonl exists');
    expect(await readFile(join(dir, 'labels.jsonl'), 'utf8')).toBe('kept');
  });
});
