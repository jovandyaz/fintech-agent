import { z } from 'zod';

import { shuffled } from '../shuffle.js';

import type { JudgeInput } from '@fintech-agent/api/evals';

/** How a draft came to be graded: from the run, or a run draft with one defect injected. */
export const ROW_SOURCES = ['run', 'mutation'] as const;
export type RowSource = (typeof ROW_SOURCES)[number];

/** The defects a script injects into real drafts (03 §Judge validation step 3). */
export const MUTATIONS = [
  'changed_date',
  'dropped_citation',
  'added_promise',
] as const;
export type Mutation = (typeof MUTATIONS)[number];

/** A calibration row as the scripts handle it, before it is blinded for labeling. */
export interface CalibrationRow {
  row_id: string;
  case_id: string;
  variant: string;
  source: RowSource;
  mutation?: Mutation | undefined;
  judge_input: JudgeInput;
}

/** What the user reads: an opaque id and the judge's input, nothing else (blind labeling). */
export interface LabelRow {
  row_id: string;
  judge_input: JudgeInput;
}

/** What an opaque id stands for; kept in its own file, read only by the scripts. */
export type RowKey = Omit<CalibrationRow, 'judge_input'>;

/** The judge's verdict on a row, kept in its own file so labeling stays blind. */
export interface JudgeVerdict {
  row_id: string;
  judge_pass: boolean;
  judge_reason: string;
}

/** The user's label on a row: pass / fail and a one-line reason (03). */
export interface HumanLabel {
  row_id: string;
  human_pass: boolean;
  reason: string;
}

/** The judge's input, as the provider records it and the rows carry it. */
export const JudgeInputSchema = z.object({
  draft_reply: z.string(),
  cited_chunks: z.array(
    z.object({ doc_id: z.string(), section: z.string(), text: z.string() }),
  ),
  tool_outputs: z.array(z.object({ tool: z.string(), output: z.unknown() })),
});

const LabelRowSchema = z.object({
  row_id: z.string().min(1),
  judge_input: JudgeInputSchema,
});

const RowKeySchema = z.object({
  row_id: z.string().min(1),
  case_id: z.string().min(1),
  variant: z.string().min(1),
  source: z.enum(ROW_SOURCES),
  mutation: z.enum(MUTATIONS).optional(),
});

const JudgeVerdictSchema = z.object({
  row_id: z.string().min(1),
  judge_pass: z.boolean(),
  judge_reason: z.string(),
});

const HumanLabelSchema = z.object({
  row_id: z.string().min(1),
  human_pass: z.boolean(),
  reason: z.string().trim().min(1),
});

/** One JSON object per line, the format of every calibration file. */
export const toJsonl = (rows: readonly object[]): string =>
  rows.map((row) => `${JSON.stringify(row)}\n`).join('');

function parseJsonl<T>(content: string, schema: z.ZodType<T>): T[] {
  return content
    .split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line !== '')
    .map(({ line, number }) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(
          `line ${number}: not one JSON object on one line (the file is JSONL)`,
        );
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        throw new Error(`line ${number}: ${parsed.error.message}`);
      }
      return parsed.data;
    });
}

/** Throws naming the line of the first row that does not parse. */
export const parseLabelRows = (content: string): LabelRow[] =>
  parseJsonl(content, LabelRowSchema);

/** Throws naming the line of the first key that does not parse. */
export const parseRowKeys = (content: string): RowKey[] =>
  parseJsonl(content, RowKeySchema);

/** Throws naming the line of the first verdict that does not parse. */
export const parseJudgeVerdicts = (content: string): JudgeVerdict[] =>
  parseJsonl(content, JudgeVerdictSchema);

/** Throws naming the line of a label that does not parse or has no reason. */
export const parseHumanLabels = (content: string): HumanLabel[] =>
  parseJsonl(content, HumanLabelSchema);

const ROW_ID_DIGITS = 3;

/**
 * Blinds the rows for labeling: shuffled, renumbered `row-001…`, so neither
 * the order nor the id tells a planted failure, a case or a variant; the
 * keys and the verdicts carry the same opaque ids.
 */
export function blindRows(
  rows: readonly CalibrationRow[],
  verdicts: readonly JudgeVerdict[],
  random: () => number,
): { toLabel: LabelRow[]; keys: RowKey[]; verdicts: JudgeVerdict[] } {
  const order = shuffled(rows, random);
  const opaque = new Map(
    order.map((row, index) => [
      row.row_id,
      `row-${String(index + 1).padStart(ROW_ID_DIGITS, '0')}`,
    ]),
  );
  const idOf = (rowId: string): string => {
    const id = opaque.get(rowId);
    if (!id) throw new Error(`a verdict names no row: ${rowId}`);
    return id;
  };
  return {
    toLabel: order.map((row) => ({
      row_id: idOf(row.row_id),
      judge_input: row.judge_input,
    })),
    keys: order.map(({ row_id, case_id, variant, source, mutation }) => ({
      row_id: idOf(row_id),
      case_id,
      variant,
      source,
      ...(mutation ? { mutation } : {}),
    })),
    verdicts: verdicts.map((verdict) => ({
      ...verdict,
      row_id: idOf(verdict.row_id),
    })),
  };
}
