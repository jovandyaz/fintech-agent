import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { fillPlaceholders, type JudgeInput } from '@fintech-agent/api/evals';
import { FOLIO_GROUP_PATTERN } from '@fintech-agent/contracts';

import { fixtureOf } from '../fixtures.js';
import {
  parseHumanLabels,
  parseLabelRows,
  parseRowKeys,
  toJsonl,
  type HumanLabel,
  type LabelRow,
  type RowKey,
} from './rows.js';

const FILES = {
  key: 'key.jsonl',
  toLabel: 'to-label.jsonl',
  labels: 'labels.jsonl',
} as const;
const UTF8 = 'utf8';
const FOLIO_IN_TEXT = new RegExp(
  `AC-${FOLIO_GROUP_PATTERN}-${FOLIO_GROUP_PATTERN}`,
);
const CUSTOMER_TOOL = 'get_customer';
const NO_FOLIO = '';

/** One export's rows: what each opaque id stands for and what the labeler read. */
export interface ExportedRows {
  keys: readonly RowKey[];
  rows: readonly LabelRow[];
}

/** What `carryLabels` did with each label and row. */
export interface CarryOutcome {
  /** The carried labels, under the new row ids. */
  labels: HumanLabel[];
  carried: { from: string; to: string }[];
  /** Old labeled rows with no row in the new export (a run with no reply, a mutation not drawn again). */
  dropped: string[];
  /** New rows with no label carried to them. */
  relabel: string[];
}

const identityOf = ({ case_id, variant, source, mutation }: RowKey): string =>
  [case_id, variant, source, mutation ?? ''].join('|');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function textJsonOf(output: unknown): unknown {
  const content: unknown = isRecord(output) ? output['content'] : null;
  const part: unknown = Array.isArray(content) ? content[0] : null;
  if (!isRecord(part) || typeof part['text'] !== 'string') return null;
  try {
    return JSON.parse(part['text']);
  } catch {
    return null;
  }
}

/** The first name the harness filled `{{nombre}}` with: the last customer `get_customer` returned. */
function firstNameIn(input: JudgeInput): string | null {
  const names = input.tool_outputs
    .filter(({ tool }) => tool === CUSTOMER_TOOL)
    .map(({ output }) => textJsonOf(output))
    .flatMap((customer) =>
      isRecord(customer) && typeof customer['first_name'] === 'string'
        ? [customer['first_name']]
        : [],
    );
  return names.at(-1) ?? null;
}

/**
 * Whether the unfilled draft judged now is the filled draft labeled before:
 * the same chunks and tool outputs, and filling the new draft's placeholders
 * as the harness did (the fixture's received date, the first name
 * `get_customer` returned, the case folio, which the stored rows keep only
 * inside the old draft) gives back the old draft exactly. A draft the
 * harness could not fill is not the same draft.
 */
function sameDraftFilled(
  caseId: string,
  fresh: JudgeInput,
  labeled: JudgeInput,
): boolean {
  if (
    !isDeepStrictEqual(fresh.cited_chunks, labeled.cited_chunks) ||
    !isDeepStrictEqual(fresh.tool_outputs, labeled.tool_outputs)
  ) {
    return false;
  }
  const { receivedAt } = fixtureOf(caseId);
  try {
    return (
      fillPlaceholders(fresh.draft_reply, {
        receivedAt,
        folio: FOLIO_IN_TEXT.exec(labeled.draft_reply)?.[0] ?? NO_FOLIO,
        firstName: firstNameIn(fresh),
      }) === labeled.draft_reply
    );
  } catch {
    return false;
  }
}

/**
 * Carries the labels of an export judged on filled drafts to a new export of
 * the same run judged on unfilled ones (03 §Judge validation): a label
 * moves to the new row of the same case, variant, source and mutation only
 * when that row is the labeled draft with its placeholders unfilled
 * (`sameDraftFilled`); every other new row needs a new label.
 */
export function carryLabels(input: {
  old: ExportedRows & { labels: readonly HumanLabel[] };
  fresh: ExportedRows;
}): CarryOutcome {
  const oldKeys = new Map(input.old.keys.map((key) => [key.row_id, key]));
  const oldRows = new Map(input.old.rows.map((row) => [row.row_id, row]));
  const freshKeys = new Map(
    input.fresh.keys.map((key) => [identityOf(key), key]),
  );
  const freshRows = new Map(input.fresh.rows.map((row) => [row.row_id, row]));
  const labels: HumanLabel[] = [];
  const carried: CarryOutcome['carried'] = [];
  const dropped: string[] = [];
  for (const label of input.old.labels) {
    const key = oldKeys.get(label.row_id);
    const labeled = oldRows.get(label.row_id);
    if (!key || !labeled) {
      throw new Error(`label ${label.row_id} names no row of the old export`);
    }
    const freshKey = freshKeys.get(identityOf(key));
    if (!freshKey) {
      dropped.push(label.row_id);
      continue;
    }
    const fresh = freshRows.get(freshKey.row_id);
    if (!fresh) throw new Error(`key ${freshKey.row_id} names no new row`);
    if (sameDraftFilled(key.case_id, fresh.judge_input, labeled.judge_input)) {
      labels.push({ ...label, row_id: freshKey.row_id });
      carried.push({ from: label.row_id, to: freshKey.row_id });
    }
  }
  const carriedTo = new Set(carried.map(({ to }) => to));
  return {
    labels,
    carried,
    dropped,
    relabel: input.fresh.keys
      .map(({ row_id }) => row_id)
      .filter((rowId) => !carriedTo.has(rowId))
      .sort(),
  };
}

const readRows = async (dir: string): Promise<ExportedRows> => ({
  keys: parseRowKeys(await readFile(join(dir, FILES.key), UTF8)),
  rows: parseLabelRows(await readFile(join(dir, FILES.toLabel), UTF8)),
});

/**
 * `pnpm eval:carry-labels <old calibration dir>`: carries the labels kept in
 * `oldDir` to the export now in `dir` and writes them to `dir/labels.jsonl`,
 * printing the rows carried, dropped and left to relabel. Refuses while
 * `dir/labels.jsonl` exists, so no label is overwritten.
 */
export async function carryLabelFiles(input: {
  oldDir: string;
  dir: string;
  log: (line: string) => void;
}): Promise<CarryOutcome> {
  const labelsPath = join(input.dir, FILES.labels);
  const labelsExist = await access(labelsPath).then(
    () => true,
    () => false,
  );
  if (labelsExist) {
    throw new Error(
      `${FILES.labels} exists in ${input.dir}: carried labels are written only into a fresh export`,
    );
  }
  const outcome = carryLabels({
    old: {
      ...(await readRows(input.oldDir)),
      labels: parseHumanLabels(
        await readFile(join(input.oldDir, FILES.labels), UTF8),
      ),
    },
    fresh: await readRows(input.dir),
  });
  await writeFile(labelsPath, toJsonl(outcome.labels));
  input.log(
    `carried ${outcome.carried.length}: ${outcome.carried.map(({ from, to }) => `${from} → ${to}`).join(', ')}`,
  );
  input.log(`dropped ${outcome.dropped.length}: ${outcome.dropped.join(', ')}`);
  input.log(
    `to relabel ${outcome.relabel.length}: ${outcome.relabel.join(', ')}`,
  );
  return outcome;
}
