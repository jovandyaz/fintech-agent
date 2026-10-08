import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hasPii } from '@fintech-agent/contracts';
import type { EvaluateResult } from 'promptfoo';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  latestRunRecord,
  readBaseline,
  resultsFileOf,
  slimResult,
  writeRunRecord,
  type RunRecord,
} from './results.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'evals-results-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const recordOf = (
  timestamp: string,
  commit: string,
  scope: { full?: boolean; incomplete?: string[] } = {},
): RunRecord =>
  ({
    meta: {
      timestamp,
      date: timestamp.slice(0, 10),
      commit,
      judgeModel: 'claude-opus-5-5',
      rubricSha256: 'f'.repeat(64),
      variants: ['variant-A', 'variant-B'],
      caseIds: ['GEN-01'],
      full: scope.full ?? true,
      incomplete: scope.incomplete ?? [],
    },
    summary: scope.incomplete?.length ? null : { gate: [] },
    results: [],
  }) as unknown as RunRecord;

describe('slimResult', () => {
  it('keeps the case, variant, recorded attempt and each verdict, and drops the test and prompt', () => {
    const result = {
      vars: { case_id: 'GEN-01' },
      provider: { id: 'eval', label: 'variant-A' },
      response: { output: 'x', metadata: { repeat_index: 0 } },
      testCase: { assert: [{ type: 'javascript', value: () => true }] },
      prompt: { raw: '{{case_id}}', label: 'p' },
      gradingResult: {
        pass: true,
        score: 1,
        reason: 'ok',
        componentResults: [
          {
            pass: false,
            score: 0,
            reason: 'unsupported',
            assertion: { type: 'llm-rubric', value: 'rubric' },
            metadata: { graderError: false },
            tokensUsed: { total: 12, prompt: 10, completion: 2 },
          },
          {
            pass: false,
            score: 0,
            reason: 'grader unreachable',
            assertion: { type: 'llm-rubric' },
            metadata: { graderError: true },
          },
        ],
      },
    } as unknown as EvaluateResult;
    const leaky = {
      ...result,
      gradingResult: {
        componentResults: [
          {
            pass: false,
            reason: 'the draft cites card 4111111111111111',
            assertion: { type: 'llm-rubric' },
          },
        ],
      },
    } as unknown as EvaluateResult;
    expect(
      hasPii(
        slimResult(leaky).gradingResult?.componentResults?.[0]?.reason ?? '',
      ),
    ).toBe(false);
    expect(slimResult(result)).toEqual({
      vars: { case_id: 'GEN-01' },
      provider: { id: 'eval', label: 'variant-A' },
      response: { metadata: { repeat_index: 0 } },
      gradingResult: {
        componentResults: [
          {
            pass: false,
            reason: 'unsupported',
            assertion: { type: 'llm-rubric' },
            metadata: { graderError: false },
            tokensUsed: { prompt: 10, completion: 2 },
          },
          {
            pass: false,
            reason: 'grader unreachable',
            assertion: { type: 'llm-rubric' },
            metadata: { graderError: true },
            tokensUsed: { prompt: undefined, completion: undefined },
          },
        ],
      },
    });
  });
});

describe('the run record (03 §Runner: evals/results/<date>-<commit>…json)', () => {
  it('names the file by date, commit and time, marking a subset or incomplete run', () => {
    const meta = recordOf('2026-10-08T15:30:12.345Z', 'abc1234').meta;
    expect(resultsFileOf(meta)).toBe('2026-10-08-abc1234-153012Z.json');
    expect(resultsFileOf({ ...meta, full: false })).toBe(
      '2026-10-08-abc1234-153012Z-subset.json',
    );
    expect(
      resultsFileOf({ ...meta, incomplete: ['variant-B GEN-01 (1)'] }),
    ).toBe('2026-10-08-abc1234-153012Z-incomplete.json');
    expect(
      resultsFileOf({
        ...meta,
        full: false,
        incomplete: ['variant-B GEN-01 (1)'],
      }),
    ).toBe('2026-10-08-abc1234-153012Z-incomplete.json');
  });

  it('never overwrites an earlier run of the same commit', async () => {
    const first = await writeRunRecord(
      dir,
      recordOf('2026-10-08T09:00:00.000Z', 'abc1234'),
    );
    const second = await writeRunRecord(
      dir,
      recordOf('2026-10-08T10:00:00.000Z', 'abc1234', { full: false }),
    );
    expect(first).not.toBe(second);
    expect(await readFile(first, 'utf8')).toMatch(/\n$/);
  });

  it('reads back the newest complete full run by time, whatever the commit sorts as', async () => {
    await writeRunRecord(dir, recordOf('2026-10-08T09:00:00.000Z', 'fff9999'));
    await writeRunRecord(dir, recordOf('2026-10-08T11:00:00.000Z', '1a2b3c4'));
    await writeRunRecord(
      dir,
      recordOf('2026-10-08T12:00:00.000Z', 'abc1234', { full: false }),
    );
    await writeRunRecord(
      dir,
      recordOf('2026-10-08T13:00:00.000Z', 'abc1234', {
        incomplete: ['variant-B GEN-01 (1)'],
      }),
    );
    await writeFile(join(dir, 'notes.json'), '{}');
    expect((await latestRunRecord(dir)).meta.commit).toBe('1a2b3c4');
  });

  it('says which step writes a record when there is none', async () => {
    await writeRunRecord(
      dir,
      recordOf('2026-10-08T12:00:00.000Z', 'abc1234', { full: false }),
    );
    await expect(latestRunRecord(dir)).rejects.toThrow(
      'run pnpm eval with no --only, --variant or --repeat first',
    );
    await expect(latestRunRecord(join(dir, 'missing'))).rejects.toThrow(
      'pnpm eval',
    );
  });
});

describe('readBaseline', () => {
  it('has no baseline before the first run sets one', async () => {
    expect(await readBaseline(join(dir, 'baseline.json'))).toBeNull();
  });

  it('reads the committed baseline', async () => {
    const baseline = {
      commit: 'abc1234',
      high_stakes_passed: { 'variant-A': ['ADV-01'] },
    };
    await writeFile(join(dir, 'baseline.json'), JSON.stringify(baseline));
    expect(await readBaseline(join(dir, 'baseline.json'))).toEqual(baseline);
  });
});
