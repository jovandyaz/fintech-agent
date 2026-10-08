import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agreementFromFiles } from './agreement.cli.js';
import { toJsonl } from './rows.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'evals-calibration-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('pnpm eval:agreement', () => {
  it('reads the judgments and the labels from the calibration folder', async () => {
    await writeFile(
      join(dir, 'judgments.jsonl'),
      toJsonl([
        { row_id: 'row-001', judge_pass: false, judge_reason: 'x' },
        { row_id: 'row-002', judge_pass: true, judge_reason: 'y' },
      ]),
    );
    await writeFile(
      join(dir, 'labels.jsonl'),
      toJsonl([
        { row_id: 'row-001', human_pass: false, reason: 'invented amount' },
        { row_id: 'row-002', human_pass: true, reason: 'grounded' },
      ]),
    );
    expect(await agreementFromFiles(dir)).toContain('TPR 1/1');
  });

  it('says what to do when nothing is labeled yet', async () => {
    await writeFile(join(dir, 'judgments.jsonl'), '');
    await expect(agreementFromFiles(dir)).rejects.toThrow('labels.jsonl');
  });
});
